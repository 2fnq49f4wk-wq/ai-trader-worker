"""Threads 게시(GitHub Actions 전용) — 토큰은 secrets.THREADS_ACCESS_TOKEN(Bearer 헤더 · 로그에 안 찍힘).
사용: python3 tools/threads/post.py <TEXT_FILE> <IMAGE|VIDEO|TEXT|CAROUSEL> <MEDIA_URL|-> <TOPIC_TAG|->   · check 만: python3 tools/threads/post.py --check"""
import json, os, sys, time, urllib.parse, urllib.request, urllib.error

API = "https://graph.threads.net/v1.0/"
TOKEN = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
USER = os.environ.get("THREADS_USER_ID", "28145953421747404")


def call(method, path, params=None):
    params = params or {}
    data = urllib.parse.urlencode(params).encode() if method == "POST" else None
    url = API + path + ("" if method == "POST" or not params else "?" + urllib.parse.urlencode(params))
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + TOKEN})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        print("API 오류", e.code, e.read().decode()[:300]); sys.exit(1)


if not TOKEN:
    print("THREADS_ACCESS_TOKEN 비밀값이 없습니다"); sys.exit(1)
me = call("GET", "me", {"fields": "id,username"})
print("토큰 확인: @" + me.get("username", "?"))
if len(sys.argv) > 1 and sys.argv[1] == "--check":
    sys.exit(0)

text_file, kind, media, topic = sys.argv[1], sys.argv[2].upper(), sys.argv[3], sys.argv[4]
text = open(text_file, encoding="utf-8").read().strip()
p = {"text": text, "media_type": kind}
if topic and topic != "-":
    p["topic_tag"] = topic
if kind == "IMAGE":
    p["image_url"] = media
elif kind == "VIDEO":
    p["video_url"] = media
def wait(cid):
    st = {}
    for _ in range(60):
        st = call("GET", cid, {"fields": "status,error_message"})
        if st.get("status") in ("FINISHED", "ERROR", "EXPIRED"):
            break
        time.sleep(5)
    if st.get("status") != "FINISHED":
        print("미디어 처리 실패", st); sys.exit(1)


if kind == "CAROUSEL":   # 이미지 여러 장: media 에 쉼표로 구분한 주소 2~20개
    kids = []
    for u in [x.strip() for x in media.split(",") if x.strip()]:
        k = call("POST", USER + "/threads", {"media_type": "IMAGE", "image_url": u, "is_carousel_item": "true"})["id"]
        wait(k); kids.append(k)
    p.pop("image_url", None)
    p["children"] = ",".join(kids)
cid = call("POST", USER + "/threads", p)["id"]
wait(cid)
mid = call("POST", USER + "/threads_publish", {"creation_id": cid})["id"]
info = call("GET", mid, {"fields": "permalink"})
print("게시 완료:", info.get("permalink"))
