# HT Labs iPhone build

The iPhone shell loads the production website at `https://gethtlabs.com`, so the website and app share the same backend and production data. Website deployments appear in the app without rebuilding the native project.

## Refresh the native project

```bash
cd "/Users/johndoe/Documents/Codex/2026-08-14/ht-labs-ios-current"
npm run ios:sync
npm run ios:open
```

In Xcode, select the **App** target, choose **Signing & Capabilities**, keep **Automatically manage signing** enabled, and select your **Personal Team**. Connect and unlock the iPhone, choose it as the run destination, then press the Run button.

Free Personal Team installations expire periodically, so Xcode may need to install the app again. The website itself remains unchanged by this iOS project.
