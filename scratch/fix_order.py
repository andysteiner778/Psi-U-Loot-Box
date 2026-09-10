import io
p='app/api/admin/items/route.ts'
s=io.open(p,encoding='utf-8').read()

# the misplaced doc block + cfg declaration
start = s.index('  /*\n   * Scrap value and box tier both come from lib/scrap.ts')
end = s.index('  const cfg = await readConfig();', start) + len('  const cfg = await readConfig();\n')
block = s[start:end]
s = s[:start] + s[end:]

# re-insert above the tier comment
anchor = s.index('  /*\n   * Retail decides the box.')
s = s[:anchor] + block + '\n' + s[anchor:]

# tidy the double blank line left behind
s = s.replace('Math.max(autoScrap, 0));\n\n\n', 'Math.max(autoScrap, 0));\n\n')
io.open(p,'w',encoding='utf-8').write(s)
