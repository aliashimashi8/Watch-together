"""Real headless-Chromium test of the real client + real WebRTC. Signaling goes through the real socket.js handlers.
Run: node test/harness.js &  then  python3 test/browser_test.py"""
import json, sys, time
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:3100'; results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
def wait(pred, secs=15):
    end = time.time() + secs
    while time.time() < end:
        try:
            if pred(): return True
        except Exception: pass
        time.sleep(0.25)
    return False
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
audio_in = '''async()=>{const r=await pc.getStats();let n=0;r.forEach(s=>{if(s.type==="inbound-rtp"&&s.kind==="audio")n+=s.packetsReceived});return n}'''
with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS)
    ca = br.new_context(permissions=['microphone'], viewport={'width': 412, 'height': 915}, is_mobile=True, user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36')
    cb = br.new_context(permissions=['microphone'])
    A, B = ca.new_page(), cb.new_page()
    for pg, n in ((A, 'sara'), (B, 'ali')): pg.on('pageerror', lambda e: check('no page JS errors', False, str(e)))
    A.goto(BASE); B.goto(BASE)
    check('default language is Persian RTL', A.evaluate('document.documentElement.dir')=='rtl' and 'ساخت اتاق' in A.inner_text('#createBtn'))
    A.fill('#name', 'sara'); A.click('#createBtn')
    check('A entered room', wait(lambda: A.is_visible('#room')))
    link = A.evaluate('location.href'); room = link.split('/r/')[1]
    B.goto(BASE + '/#/r/' + room); B.reload()
    check('invite link prefilled on B', B.input_value('#code') == room)
    B.fill('#name', 'ali'); B.click('#joinBtn')
    check('both see "connected" (2 people)', wait(lambda: 'متصل' == A.inner_text('#status') and 'متصل' == B.inner_text('#status')), A.inner_text('#status')+'|'+B.inner_text('#status'))
    check('participant list shows both + host marker', wait(lambda: A.locator('#people li').count()==2) and 'میزبان' in A.inner_text('#people'))
    # voice
    check('mic permission granted -> local stream', A.evaluate('!!localStream') and B.evaluate('!!localStream'))
    check('voice pill "connected" both sides', wait(lambda: 'صدا وصل است'==A.inner_text('#voice') and 'صدا وصل است'==B.inner_text('#voice')), A.inner_text('#voice')+'|'+B.inner_text('#voice'))
    check('real audio RTP packets received A and B', wait(lambda: A.evaluate(audio_in)>20 and B.evaluate(audio_in)>20))
    A.click('#muteBtn'); check('mute disables mic track', A.evaluate('localStream.getAudioTracks()[0].enabled')==False and 'وصل' in A.inner_text('#muteBtn'))
    A.click('#muteBtn')
    # sync
    A.fill('#url', BASE + '/sample.webm'); A.click('#loadBtn')
    check('media shared: both players loaded', wait(lambda: A.evaluate('v.readyState>=1') and B.evaluate('v.readyState>=1') and B.evaluate('v.src').endswith('sample.webm')))
    A.evaluate('v.play()')
    check('PLAY syncs', wait(lambda: B.evaluate('!v.paused')))
    time.sleep(1.5)
    d = abs(A.evaluate('v.currentTime') - B.evaluate('v.currentTime')); check('positions within 1s while playing', d < 1.0, f'drift={d:.2f}')
    A.evaluate('v.pause()'); check('PAUSE syncs', wait(lambda: B.evaluate('v.paused')))
    A.evaluate('v.currentTime=30'); check('SEEK syncs', wait(lambda: abs(B.evaluate('v.currentTime')-30)<1), str(B.evaluate('v.currentTime')))
    B.evaluate('v.play()'); check('B can control too (play)', wait(lambda: A.evaluate('!v.paused')))
    B.evaluate('v.playbackRate=1.5'); check('RATE syncs', wait(lambda: A.evaluate('v.playbackRate')==1.5))
    # drift correction: break B by 5s locally without emitting, host tick must fix it
    B.evaluate('quietUntil=Date.now()+1500; v.currentTime=v.currentTime+8')
    check('DRIFT correction by host tick', wait(lambda: abs(A.evaluate('v.currentTime')-B.evaluate('v.currentTime'))<1.0, 10))
    # chat
    A.fill('#msg','salam'); A.click('#sendBtn'); check('chat A->B', wait(lambda: 'salam' in B.inner_text('#log')))
    B.fill('#msg','hi'); B.press('#msg','Enter'); check('chat B->A', wait(lambda: 'hi' in A.inner_text('#log')))
    # reconnect B
    A.evaluate('v.pause()'); wait(lambda: B.evaluate('v.paused'))
    url_before = B.evaluate('v.currentSrc'); B.evaluate('window.__sock._drop()')
    check('B shows reconnecting', wait(lambda: 'تلاش' in B.inner_text('#status'), 3))
    check('B reconnects and rejoins', wait(lambda: B.inner_text('#status')=='متصل' and A.inner_text('#status')=='متصل'))
    check('voice recovers after reconnect', wait(lambda: 'صدا وصل است'==B.inner_text('#voice') and B.evaluate(audio_in)>20 and A.evaluate(audio_in)>20, 20), B.inner_text('#voice'))
    check('video NOT reloaded on reconnect', B.evaluate('v.currentSrc')==url_before and B.evaluate('v.readyState')>=1)
    # slow reconnect (sleeping free-plan server) must explain itself, then clear
    B.evaluate('window.__sock._drop(11000)')
    check('slow reconnect shows "server waking up" hint', wait(lambda: 'بیدار' in B.inner_text('#toast'), 12))
    check('hint clears after server returns', wait(lambda: B.inner_text('#status')=='متصل' and 'بیدار' not in B.inner_text('#toast'), 15))
    check('voice recovers after slow reconnect', wait(lambda: 'صدا وصل است'==B.inner_text('#voice') and A.evaluate(audio_in)>20, 20))
    # late join / refresh while playing
    A.evaluate('v.currentTime=20; v.play()'); wait(lambda: B.evaluate('!v.paused')); time.sleep(2)
    B.reload(); B.click('#joinBtn') if B.is_visible('#joinBtn') else None
    check('refresh -> late join lands at current position', wait(lambda: B.is_visible('#room') and B.evaluate('v.readyState>=1') and abs(A.evaluate('v.currentTime')-B.evaluate('v.currentTime'))<2.5 and not B.evaluate('v.paused')), f"{A.evaluate('v.currentTime')} vs {B.evaluate('v.currentTime')}")
    # third person / full
    cc = br.new_context(permissions=['microphone']); C = cc.new_page(); C.goto(BASE + '/#/r/' + room); C.reload(); C.click('#joinBtn')
    check('third person gets "room full"', wait(lambda: 'پر است' in C.inner_text('#homeErr')), C.inner_text('#homeErr'))
    # iframe path + same-origin guard
    A.fill('#url','https://example.com/movie-page'); A.click('#loadBtn')
    check('website URL -> iframe mode with limitation note', wait(lambda: A.is_visible('#frame') and A.is_visible('#frameNote') and B.is_visible('#frame')))
    A.fill('#url', BASE + '/index.html'); A.click('#loadBtn'); time.sleep(.5)
    check('same-origin page refused for iframe', wait(lambda: 'معتبر' in A.inner_text('#toast')) and '/index.html' not in A.evaluate('frame.src'))
    A.fill('#url','javascript:alert(1)'); A.click('#loadBtn'); check('invalid URL shows error', wait(lambda: 'معتبر' in A.inner_text('#toast')))
    # screen share
    A.fill('#url', BASE + '/sample.webm'); A.click('#loadBtn'); time.sleep(1)
    has = A.evaluate('!!navigator.mediaDevices.getDisplayMedia'); check('getDisplayMedia exists (desktop-style Chromium)', has)
    A.evaluate('document.querySelector("#shareBtn").click()'); time.sleep(2)
    shared = A.evaluate('!!sharing'); print('INFO screen share in headless:', 'started' if shared else 'blocked by headless env (not a pass/fail)')
    if shared: check('remote sees shared screen', wait(lambda: not B.evaluate('scr.hidden')))
    # leave
    A.click('#leaveBtn'); check('leave returns home', A.is_visible('#home'))
    check('other side sees waiting after leave', wait(lambda: 'منتظر' in B.inner_text('#status')))
    # mic denied
    br2 = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    D = br2.new_context().new_page(); D.goto(BASE); D.click('#createBtn')
    check('mic denied -> clear error, app still usable', wait(lambda: 'میکروفون' in D.inner_text('#toast')) and 'بدون میکروفون' in D.inner_text('#voice') and D.is_visible('#room'), D.inner_text('#toast'))
    # PWA
    pw = ca.new_page(); pw.goto(BASE)
    m = json.loads(pw.evaluate('fetch("/manifest.webmanifest").then(r=>r.text())'))
    check('manifest has name/start_url/display/icons 192+512', all(k in m for k in ('name','start_url','display','icons')) and {'192x192','512x512'} <= {i['sizes'] for i in m['icons']})
    check('all manifest icons load', all(pw.evaluate('u=>fetch(u).then(r=>r.ok)', i['src']) for i in m['icons']))
    check('service worker active', wait(lambda: pw.evaluate('navigator.serviceWorker.ready.then(r=>!!r.active)'), 10))
    pw.reload(); time.sleep(1); ca.set_offline(True)
    try: pw.reload(); check('app shell loads offline from SW cache', 'فیلم' in pw.inner_text('h1'))
    except Exception as e: check('app shell loads offline from SW cache', False, str(e)[:80])
    ca.set_offline(False)
    br.close(); br2.close()
bad = [n for n, ok in results if not ok]; print(f'\n{len(results)-len(bad)}/{len(results)} passed'); sys.exit(1 if bad else 0)
