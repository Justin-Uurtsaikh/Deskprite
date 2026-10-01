# Deskprite

[![Quality checks](https://github.com/Justin-Uurtsaikh/Deskprite/actions/workflows/quality.yml/badge.svg)](https://github.com/Justin-Uurtsaikh/Deskprite/actions/workflows/quality.yml)

**Draw a buddy. Bring it to your desktop.** Deskprite is Justin Uurtsaikh's open-source app for drawing animated desktop buddies or importing transparent PNG sprite sheets on macOS and Windows.

[Website](https://justin-uurtsaikh.github.io/Deskprite/) · [Transparent PNG sprite guide](https://justin-uurtsaikh.github.io/Deskprite/guide/) · [Download source](https://github.com/Justin-Uurtsaikh/Deskprite/archive/refs/heads/main.zip) · [Report an issue](https://github.com/Justin-Uurtsaikh/Deskprite/issues)

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/deskprite-demo-still.png">
  <img src="docs/assets/deskprite-demo.gif" alt="Sprout walking across the Deskprite desktop preview" width="640" height="360">
</picture>

Built with Electron and JavaScript.

## Project website

The [live Deskprite website](https://justin-uurtsaikh.github.io/Deskprite/) is published from [`docs/`](docs/index.html), with a dedicated [transparent PNG sprite and setup guide](https://justin-uurtsaikh.github.io/Deskprite/guide/). It uses plain HTML, CSS, and JavaScript with no build step or third-party assets.

## Run it on Mac or Windows

1. Install [Node.js](https://nodejs.org/) (version 22.12 or later). On Mac, Electron 44 requires macOS 13 or later.
2. Open Terminal (Mac) or PowerShell (Windows) in this `deskprite` folder.
3. Run:

   ```sh
   npm install
   npm run dev
   ```

4. Choose a **Starter buddy**, **Import sprite sheet**, or **Draw your own**. Preview the idle and walk loops, choose whether the buddy wanders or stays put, then select **Create & launch**.

Your buddy appears as only a transparent sprite—no border, white card, hover buttons, heart, or exit control. Drag the sprite itself anywhere. New buddies start at `112 px` and can be sized from `64 px` to `192 px`. They switch to their walk frames while moving, return to idle when they stop, and wrap to the opposite side after walking fully past any screen edge. You can set how often and how far each buddy walks, choose a preferred part of the screen, and optionally keep it on one monitor.

## Make a sprite

### Pick a starter buddy

Open **Starter buddies**, choose a character, adjust its name and size, then select **Create & launch**. Every bundled starter includes four idle frames and four walking frames with a transparent background.

### Import a sprite sheet

Deskprite accepts transparent PNG sprite sheets with real transparent pixels.
After upload, it shows the complete sheet with a cell grid and separate highlights for idle and walk frames. Pick the grid that puts one complete character in each cell, then use the Advanced controls only if you need to change a clip's row, starting column, or frame count. A common layout is four idle frames on row 1 and four walk frames on row 2.

The source must be the clean PNG sprite sheet—not a screenshot with a checkerboard background, labels, grid lines, borders, or a white background. Deskprite's sprite validation and packaging currently support PNG files only.

### Drawing a sprite in Deskprite

Switch to **Draw your own**. Choose your desired brush color and size, draw the current frame, then use **Add frame** for the next pose. Make at least one visible `Idle` frame and one visible `Walk` frame for it to create a sprite. Turn on **Previous frame** to see a semi-transparent onion-skin reference while drawing the next frame; it is never saved into your art.

For the full workflow and layout examples, see [`docs/SPRITE_WORKFLOWS.md`](docs/SPRITE_WORKFLOWS.md).

## Edit a saved buddy

Each saved-buddy card shows whether that buddy is currently on the desktop or hidden. Select **Edit** to rename it, change its size, switch between wandering and staying put, or adjust all four walking-behavior settings. These changes are saved locally and are applied to an open buddy immediately.

## Create an app file

After `npm install`, run:

```sh
npm run dist
```

On Windows, the portable `.exe` is created in `release/`. On a Mac, a `.dmg` is created there instead.

## App icon

Deskprite uses Sprout's first idle frame for its app and Dock icon. If that source artwork changes, rebuild the icon with:

```sh
npm run icon
```

## Privacy and safety choices

- Sprites are copied into Deskprite's private app-data folder; nothing is uploaded.
- Only PNGs with real transparent pixels and visible artwork are accepted.
- Each source image is limited to 5 MB and 16 megapixels. Animation sets are limited to eight frames per clip and 12 MB total.
- The renderer cannot access Node.js or your file system directly.

## Development check

Run the automated tests on their own with:

```sh
npm test
```

Run the full local quality check with:

```sh
npm run check
```

GitHub Actions runs the same quality check automatically on every push and pull request. The suite directly covers saved behavior updates, delayed buddy-window loading, hiding during loading, and out-of-order sprite imports.

Regenerate the README animation and its reduced-motion still from Sprout's bundled walk frames with:

```sh
npm run demo-gif
```

This project includes source code only. Run it on your Mac or Windows desktop to test the transparent companion window, then package it with `npm run dist`.
