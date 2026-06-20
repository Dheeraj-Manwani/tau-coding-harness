import { env } from "./lib/env";
import express from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import authRoutes from "./routes/auth.routes";
import projectRoutes from "./routes/project.routes";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { requireAuth } from "./middleware/auth.middleware";

const app = express();
const PORT = env.PORT;

app.use(express.json());
app.use(cookieParser());

app.use(passport.initialize());

app.use("/auth", authRoutes);

app.use(requireAuth);

app.use("/project", projectRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => console.log(`Server started on ${PORT}`));
