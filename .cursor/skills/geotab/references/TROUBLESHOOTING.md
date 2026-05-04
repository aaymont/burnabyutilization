# Troubleshooting & Common Mistakes

## Debugging Checklist

When an Add-In doesn't work:

1. **Click "Copy Debug Data"** — paste the result to your AI assistant for diagnosis
2. **Check callback** — are you calling `callback()` in initialize?
3. **Check GitHub Pages** — is the URL accessible? Wait 2-3 minutes after push
4. **Test the URL** — open it directly in browser, does it load?
5. **Check configuration** — valid JSON? Correct URL?
6. **Hard refresh** — Clear cache with Ctrl+Shift+R
7. **Browser console (F12)** — fallback if the Add-In can't render or Copy Debug returns empty data

## Copy Debug Data Button (Essential for AI-Assisted Debugging)

Every Add-In should include a "Copy Debug Data" button that copies raw API response data to the clipboard. This is critical for the AI-assisted debugging loop: the user clicks the button, pastes the data back to their AI assistant, and the AI can diagnose the actual problem from real data instead of guessing.

```javascript
var _debugData = {};  // Store raw API responses

function copyDebugData() {
    var t = document.createElement('textarea');
    t.value = JSON.stringify(_debugData, null, 2);
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    document.body.removeChild(t);
    alert('Debug data copied to clipboard! Paste it back to the AI chat for analysis.');
}

// Store data samples in every API callback:
api.call('Get', { typeName: 'Device' }, function(devices) {
    _debugData.devices = devices.slice(0, 5);  // First 5 for debugging
    // ... your logic
}, function(err) {
    _debugData.lastError = String(err.message || err);
});
```

**HTML button (add alongside the debug log toggle):**
```html
<button onclick='copyDebugData()' style='background:#f39c12;color:#fff;border:none;padding:4px 16px;cursor:pointer;font-size:12px;border-radius:4px 4px 0 0;margin-left:4px;'>Copy Debug Data</button>
```

### Why This Matters

In practice, when users report problems to an AI assistant, the AI tends to guess at causes (name mismatch? permissions? CDN issue?) and generate speculative fixes one after another. Each failed guess wastes a full copy-paste-install cycle. The "Copy Debug Data" button short-circuits this: one click gives the AI the actual data to diagnose the real problem immediately.

## On-Screen Debug Console (Fallback)

The "Copy Debug Data" button above is the primary debugging tool — it feeds real API data straight to the AI. Use this on-screen console as a **fallback** when the Add-In is too broken to render its buttons, when Copy Debug returns empty data, or when you need to trace execution order in real time:

```javascript
// Add this to your Add-In for visible debug output
function setupDebugConsole() {
    var debugDiv = document.createElement("div");
    debugDiv.id = "debug-console";
    debugDiv.style.cssText = "position:fixed;bottom:0;left:0;right:0;max-height:200px;" +
        "overflow-y:auto;background:#1a1a1a;color:#00ff00;font-family:monospace;" +
        "font-size:12px;padding:10px;z-index:9999;border-top:2px solid #333;";
    document.body.appendChild(debugDiv);

    // Override console.log to also display on screen
    var originalLog = console.log;
    console.log = function() {
        var args = Array.prototype.slice.call(arguments);
        var message = args.map(function(arg) {
            return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
        }).join(" ");

        var line = document.createElement("div");
        line.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;
        debugDiv.appendChild(line);
        debugDiv.scrollTop = debugDiv.scrollHeight;

        originalLog.apply(console, arguments);
    };

    console.log("Debug console initialized");
}

// Call in initialize:
initialize: function(api, state, callback) {
    setupDebugConsole();
    console.log("Add-In starting...");
    // ... rest of your code
}
```

### Debug Console Features

- Shows timestamped log messages
- Auto-scrolls to latest
- Objects displayed as JSON
- Visible even without DevTools open
- Useful for mobile testing

## API Data Gotchas (Quick Reference)

These are the most common data-related bugs. Full code patterns and examples live in the references linked below — this section is a quick reminder of what to watch for.

| Gotcha | What goes wrong | Where to find the fix |
|--------|----------------|----------------------|
| `api.async` undefined | Crashes in some MyGeotab versions | [ADDINS.md — API Calling Conventions](ADDINS.md) |
| `this` in event handlers | `this` becomes the button element, not your object | [ADDINS.md — Common Pitfalls](ADDINS.md) |
| `DeviceStatusInfo` missing odometer | Returns 0 — use `StatusData` + `DiagnosticOdometerId` instead | [ADDINS.md — DeviceStatusInfo vs StatusData](ADDINS.md) |
| Unit conversions | Odometer is meters, engine hours is seconds — values look absurdly large | [ADDINS.md — Unit Conversions](ADDINS.md) |
| Reference objects have only `id` | `exception.device.name` is undefined — build lookup maps | [ADDINS.md — Reference Objects](ADDINS.md) |
| ExceptionEvent has no GPS | Query `LogRecord` for coordinates during the event's time range | [ADDINS.md — Reference Objects](ADDINS.md) |

For Python equivalents of these patterns, see [API_QUICKSTART.md](API_QUICKSTART.md).

## Common Add-In Mistakes (Quick Reference)

These are covered in detail (with full code examples) in [ADDINS.md — Critical Mistakes to Avoid](ADDINS.md). Summary for quick diagnosis:

| Symptom | Likely cause |
|---------|-------------|
| Add-In hangs on load | Missing `callback()` in `initialize` |
| API calls fail silently | No error callback — always pass the 4th argument to `api.call` |
| Add-In doesn't register | Using `}();` (immediate invocation) instead of `};` |
| Unexpected variable values | Implicit globals — forgot `var`/`let`/`const` |
| `state` behaves oddly | Your variable shadows the `initialize(api, state, callback)` parameter — rename yours to `appState` |
| Device count capped at 100 | Using `resultsLimit` when you meant to count all — omit it |
| `InvalidCastException` on drivers | Using `typeName: "Driver"` — use `User` with `search: { isDriver: true }` |

## GitHub Pages Issues

### Changes Not Appearing

1. **Wait 2-3 minutes** after pushing for deployment
2. **Check GitHub Actions** if deployment takes too long: go to `https://github.com/YOUR-USERNAME/YOUR-REPO/actions` to see deployment status and whether GitHub is being slow
3. **Add cache buster** to URL:
   ```json
   "url": "https://username.github.io/repo/addin.html?v=2"
   ```
4. **Hard refresh** browser: Ctrl+Shift+R

### 404 Errors

1. Verify GitHub Pages is enabled in repo settings
2. Check branch is set correctly (usually `main`)
3. Ensure files are in root or correct path
4. Check filename case sensitivity (Linux is case-sensitive)

## CORS Issues

**Symptom:** Add-In won't load, console shows CORS errors

**Solution:** Your hosting must include `Access-Control-Allow-Origin: *` header

**Platforms with proper CORS:**
- GitHub Pages
- Replit
- Netlify
- Firebase Hosting
- Vercel

## Testing Checklist for Users

1. Wait 2-3 minutes after pushing to GitHub
2. Open the HTML file directly in browser to verify it loads
3. Check browser console for errors
4. Hard refresh MyGeotab (Ctrl+Shift+R)
5. Verify the Add-In appears in menu
6. Check console for "registered" and "initializing" messages

## Working with Speed Data and ExceptionEvents

Common issues when building speeding dashboards and safety Add-Ins.

**Full reference:** See [SPEED_DATA.md](SPEED_DATA.md) for complete patterns (Python + JavaScript).

### Quick Reference: Common Speed Data Issues

**ExceptionEvent.details undefined (CONFIRMED):**
```javascript
// Wrong - crashes if details missing
Math.round(ex.details.maxSpeed)

// Correct - defensive check
(ex.details && ex.details.maxSpeed) || 0
```

**Demo database limitations (CONFIRMED):**
- `DiagnosticSpeedId` and `DiagnosticPostedRoadSpeedId` return 0 results
- Use `DiagnosticEngineRoadSpeedId` as alternative speed source
- ExceptionEvents have no `details` object in demo databases
- See SPEED_DATA.md for `detectDemoDatabase()` function to auto-detect

**Wrong diagnostic ID (CONFIRMED):**
```javascript
// Wrong - doesn't exist
diagnosticSearch: { id: "DiagnosticPostedSpeedId" }

// Correct
diagnosticSearch: { id: "DiagnosticPostedRoadSpeedId" }
```

**Unverified patterns** (see [SPEED_DATA.md](SPEED_DATA.md)):
- Time window buffering for StatusData queries (30-second buffer)
- StatusData fallback when `details` is missing

---

## When Helping Users

### Always Include:
1. The correct pattern without `()`
2. All three lifecycle methods
3. The `callback()` call in initialize
4. Error handling for API calls
5. Properly declared variables (const/let/var)
6. Clear comments explaining each part

### Always Warn About:
1. The immediate invocation mistake
2. Forgetting to call callback()
3. Name mismatches between files
4. GitHub Pages deployment wait time (2-3 minutes)
5. Browser cache (suggest hard refresh)

### After Debugging: Offer Lessons Learned

If a debugging session uncovered a non-obvious API gotcha (e.g., DeviceStatusInfo missing odometer, reference objects returning only IDs, unit conversion surprises), offer to write a short summary the user can file at https://github.com/fhoffa/geotab-vibe-guide/issues. Keep it to: what went wrong, what the actual fix was, and which API behavior was surprising. Don't offer this for trivial typos or config mistakes — only when there's a genuine lesson that would help others.
