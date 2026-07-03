with open('app/page.tsx', 'r') as f:
    content = f.read()

old = '["Scanner", "signals"],\n                      ["News", "signals"],\n                      ["Watchlist", "portfolio"],\n                    ].map(([label, mode]) => (\n                      <button\n                        key={`mock-nav-${label}`}\n                        type="button"'

new = '["Scanner", "signals"],\n                      ["News", "signals"],\n                      ["Watchlist", "portfolio"],\n                    ].map(([label, mode]) => (\n                      <button\n                        key={`mock-nav-${label}`}\n                        type="button"'

# Fix the actual nav links
old2 = '''                      ["Dashboard", "command"],
                      ["Top Convictions", "command"],
                      ["Scanner", "signals"],
                      ["News", "signals"],
                      ["Watchlist", "portfolio"],
                    ].map(([label, mode]) => (
                      <button
                        key={`mock-nav-${label}`}
                        type="button"
                        onClick={() => setActiveMode(mode as CommandMode)}
                        className={`transition hover:text-white ${label === "Top Convictions" ? "text-orange-400" : ""}`}
                      >
                        {label}
                      </button>
                    ))}'''

new2 = '''                      ["Dashboard", "command"],
                      ["Top Convictions", "command"],
                    ].map(([label, mode]) => (
                      <button
                        key={`mock-nav-${label}`}
                        type="button"
                        onClick={() => setActiveMode(mode as CommandMode)}
                        className={`transition hover:text-white ${label === "Top Convictions" ? "text-orange-400" : ""}`}
                      >
                        {label}
                      </button>
                    ))}
                    <a href="/scanner" className="transition hover:text-white">Scanner</a>
                    <a href="/news" className="transition hover:text-white">News</a>
                    <button onClick={() => document.getElementById("watchlist")?.scrollIntoView({ behavior: "smooth" })} className="transition hover:text-white">Watchlist</button>'''

if old2 in content:
    content = content.replace(old2, new2)
    with open('app/page.tsx', 'w') as f:
        f.write(content)
    print("DONE")
else:
    print("NOT FOUND - checking what's there")
    idx = content.find('mock-nav-')
    if idx > 0:
        print(content[idx-200:idx+200])
