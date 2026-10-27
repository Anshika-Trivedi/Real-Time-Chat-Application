import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import chatRouter from "./chat";
import interviewsRouter from "./interviews";
import assistantRouter from "./assistant";
import { requireAuth } from "../middlewares/requireAuth";
import { syncCurrentUser } from "../middlewares/syncCurrentUser";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(syncCurrentUser);
router.use(accountRouter);
router.use(chatRouter);
router.use(interviewsRouter);
router.use(assistantRouter);

export default router;
