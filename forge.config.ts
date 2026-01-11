import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import path from 'path';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'iMessage Stats',
    appBundleId: 'com.imessage-stats.app',
    icon: './resources/icon',
    extraResource: ['./electron/preload/preload.js'],
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      format: 'ULFO',
    }),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        nodeIntegration: false,
        entryPoints: [
          {
            html: './electron/renderer/index.html',
            js: './electron/renderer/app.ts',
            name: 'main_window',
          },
        ],
      },
    }),
  ],
};

export default config;
