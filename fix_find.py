with open('/workspace/projects/server/public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the target section using simple string search
buy_text = '\u2b06 \u4e70\u5165\u70b9 '
idx = content.find(buy_text)
if idx >= 0:
    print(f'Found buy line at {idx}')
    print(repr(content[idx-5:idx+100]))
else:
    print('Not found')