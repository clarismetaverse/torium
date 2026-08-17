import 'dotenv/config';
import { runValuationFromSupabase } from '../lib/valuation-runner.js';

const requestedRunId = process.argv[2] && process.argv[2] !== 'latest'
  ? process.argv[2]
  : process.env.TORIUM_RUN_ID || 'latest';

runValuationFromSupabase({ runId: requestedRunId })
  .then((output) => console.log(JSON.stringify(output, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
