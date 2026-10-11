# 把 legal/用户须知.md、legal/用户使用协议.md 转成 HTML，写回 index.html 里的 <template id="legal-notice|legal-terms">。
# 改协议后运行：python3 dev/build-legal.py   （改了实质内容请同时更新 index.html 里的 LEGAL_VERSION）
import html, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent

def md2html(path):
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if not t or t.startswith("# "):
            continue
        b = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", html.escape(t))
        if t.startswith("## "):
            out.append("<h4>" + b[3:] + "</h4>")
        elif t.startswith("版本：") or t.startswith("运营方："):
            out.append('<p class="lgmeta">' + b + "</p>")
        elif re.match(r"^(\d+(\.\d+)?[\.．、 ]|（\d+）)", t):
            out.append('<p class="lgli">' + b + "</p>")
        else:
            out.append("<p>" + b + "</p>")
    return "".join(out)

idx = root / "index.html"
s = idx.read_text(encoding="utf-8")
for key, name in (("notice", "用户须知.md"), ("terms", "用户使用协议.md")):
    body = md2html(root / "legal" / name)
    s, n = re.subn(r'(<template id="legal-%s">).*?(</template>)' % key, lambda m: m.group(1) + body + m.group(2), s, flags=re.S)
    assert n == 1, key
idx.write_text(s, encoding="utf-8")
print("legal templates updated")
