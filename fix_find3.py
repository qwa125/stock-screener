with open('/workspace/projects/server/public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the full block surrounding the buy/sell signals
start_marker = 'justify-content:space-between;border-top:1px dashed'
start = content.find(start_marker)
if start >= 0:
    full_start = content.rfind("html+=", 0, start)
    if full_start < 0:
        full_start = start - 50
    
end_marker = "</div></div>'"
end = content.find(end_marker, start + len(start_marker))
if end >= 0:
    full_end = end + len(end_marker)
    
    block = content[full_start:full_end]
    print('=== FULL BLOCK TO REPLACE ===')
    print(repr(block))
    print('=== END ===')
    
    # Check what comes before
    before = content[full_start-10:full_start]
    print(f'\nBefore block: {repr(before)}')