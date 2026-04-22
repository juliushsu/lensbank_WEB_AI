# Route Registration

In your server bootstrap (example `src/server.ts`):

```ts
import express from 'express';
import { registerAttendanceRoutes } from './routes';

const app = express();
app.use(express.json());

registerAttendanceRoutes(app);

app.listen(process.env.PORT ?? 3000);
```

Implemented route files:
- `src/routes/lineRoutes.ts`
- `src/routes/attendanceRoutes.ts`
- `src/routes/adminAttendanceRoutes.ts`
- `src/routes/index.ts`
