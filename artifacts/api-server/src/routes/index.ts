import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import retailersRouter from "./retailers";
import agreementsRouter from "./agreements";
import dashboardRouter from "./dashboard";
import usersRouter from "./users";
import integrationsRouter from "./integrations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(retailersRouter);
router.use(agreementsRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(integrationsRouter);

export default router;
