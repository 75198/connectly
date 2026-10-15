import { createApp } from './app.js';
import { config } from './config.js';
import { startPurgeJob } from './postextras.js';
createApp().listen(config.port, '0.0.0.0', () => console.log(`Connectly listening on :${config.port}`));
startPurgeJob(); // hourly: purge posts deleted > 30 days ago and expired stories
