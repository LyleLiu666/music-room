import {dirname} from 'node:path';
// Bun 1.4.2 drops an unused worker export but leaves its assignNames call in this
// pinned decoder's index. Bundle only the synchronous decoder we actually use.
// Node source mode still imports the untouched official npm package.
const result=await Bun.build({
  entrypoints:[process.argv[2]],
  compile:{outfile:process.argv[3],autoloadDotenv:false,autoloadBunfig:false,autoloadTsconfig:false,autoloadPackageJson:false},
  plugins:[{name:'mpg123-synchronous-entry',setup(build){
    build.onLoad({filter:/\/mpg123-decoder\/index\.js$/},({path})=>({
      loader:'js',resolveDir:dirname(path),contents:`import MPEGDecoder from './src/MPEGDecoder.js';
import { assignNames } from '@wasm-audio-decoders/common';
assignNames(MPEGDecoder, 'MPEGDecoder');
export { MPEGDecoder };`,
    }));
  }}],
});
if(!result.success){for(const log of result.logs)console.error(log);process.exitCode=1;}
