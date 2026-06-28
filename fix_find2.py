with open('/workspace/projects/server/public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the start of the buy/sell display block
buy_pos = content.find("flex-direction:column;align-items:flex-start")
if buy_pos < 0:
    buy_pos = content.find("align-items:flex-start")
print(f'Found at {buy_pos}')

# Now find the full block from around there
start = content.rfind("html+=", 0, buy_pos)
if start < 0:
    start = buy_pos - 50

# Find the closing "</div></div>'"
end_marker = "</div></div>'"
end = content.find(end_marker, buy_pos)
if end < 0:
    end = buy_pos + 300

block = content[start:end+len(end_marker)]
print(f'Block from {start} to {end+len(end_marker)}:')
print(repr(block))