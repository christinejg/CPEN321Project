import { AnalyticsController } from "../controllers/AnalysisController";
import {body, query, header} from "express-validator";

const controller = new AnalyticsController();

export const AnalysisRoutes = [
    {
        method: "get",
        route: "/api/analytics",
        action: controller.getAnalytics,
        validation: [
            query("userID").exists().isString()
        ]
    }
];