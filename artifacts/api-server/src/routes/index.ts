import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import staffRouter from "./staff";
import retailersRouter from "./retailers";
import agreementsRouter from "./agreements";
import dashboardRouter from "./dashboard";
import usersRouter from "./users";
import integrationsRouter from "./integrations";
import portalRouter from "./portal";
import formitizeRouter from "./formitize";
import syncRouter from "./sync";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(staffRouter);
router.use(retailersRouter);
router.use(agreementsRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(integrationsRouter);
router.use(portalRouter);
router.use(formitizeRouter);
router.use(syncRouter);

export default router;
