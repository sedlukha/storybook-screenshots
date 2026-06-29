/** @type {import('storybook-screenshots').StorybookScreenshotsConfig} */
export default {
  // Build Storybook before capturing. Omit if you build it in a separate step.
  buildCommand: "npm run build-storybook",
  storybookDir: "storybook-static",

  // Baselines are written here, one folder per browser-viewport-theme project.
  snapshotDir: "screenshots/__screenshots__",

  browsers: ["chromium"],
  viewports: [{ name: "desktop", width: 1280, height: 800 }],

  // Each theme is applied via Storybook globals (?globals=theme:dark).
  themes: [
    { name: "light", globals: { theme: "light" } },
    { name: "dark", globals: { theme: "dark" } },
  ],

  // Stories tagged with any of these are skipped.
  skipTags: ["!screenshot"],
}
