#!/usr/bin/env python3
"""[V33.302] 워커 응답에서 ★키 이름으로★ 필요한 필드만 골라 평평하게 찍는다.

  왜 필요했나: worker-probe 의 dump 는 '앞부분 몇 글자' 다. 그런데 /api/nn-viz 응답은
  앞쪽 수천 글자가 피처 이름·계수라, 정작 진단에 필요한 fwdN·fwdDays·valICeff 는
  언제나 잘려 나간다. 실제로 이 도구로 두 번 헛돌았다 — 자를 자리를 사람이 못 정한다.

  사용: probe-pick.py <파일> <정규식>
  배열 항목은 key/name 필드가 있으면 그 이름으로 경로를 만든다 —
  위원 명부가 roster.flow.state 처럼 읽히게 하려는 것이다(번호는 의미가 없다).
"""
import json
import re
import sys


def flatten(node, path, rx, out):
    if isinstance(node, dict):
        for k, v in node.items():
            flatten(v, path + [str(k)], rx, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            name = None
            if isinstance(v, dict):
                name = v.get("key") or v.get("name")
            flatten(v, path + [str(name) if name else str(i)], rx, out)
    else:
        if path and rx.search(path[-1]):
            out.append("%s = %s" % (".".join(path), node))


def main():
    if len(sys.argv) < 3:
        print("usage: probe-pick.py <file> <regex>")
        return 2
    try:
        with open(sys.argv[1]) as fh:
            data = json.load(fh)
    except Exception as exc:                      # noqa: BLE001 — 무엇이 왔는지 그대로 적는다
        print("(JSON 아님: %s)" % exc)
        return 0
    out = []
    flatten(data, [], re.compile(sys.argv[2]), out)
    print("\n".join(out) if out else "(맞는 키 없음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
