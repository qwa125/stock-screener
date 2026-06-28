#!/usr/bin/env python3
with open('/workspace/projects/server/public/index.html','r') as f:
    content=f.read()

# Read the exact block from the file
idx = content.find('  // 最佳介入点信号文本')
end_idx = content.find('  }else{sigText', idx)
end_idx = content.find('\n', end_idx)  # go to end of that line

exact_block = content[idx:end_idx+1]
print("=== Exact content in file ===")
print(f"Length: {len(exact_block)}")
print(repr(exact_block))

# Now check "买入信号@'+" matches
# The issue might be that the text "买入信号" isn't in my old string pattern
# Let me check what comes after the sigText that involves buyPoint/sellPoint