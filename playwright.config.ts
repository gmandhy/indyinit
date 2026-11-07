import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',fullyParallel:false,workers:1,timeout:60000,
 use:{baseURL:'http://127.0.0.1:4176',...devices['Desktop Chrome'],trace:'retain-on-failure'},
 webServer:{command:'npm run preview -- --host 127.0.0.1 --port 4176 --strictPort',url:'http://127.0.0.1:4176',reuseExistingServer:false},
});
