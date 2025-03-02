import { NextFunction, Request, Response } from "express";
import { client } from "../../services";
import { getWeekSummary, unpackPastWeekStats } from "../utils/analysisFunctions";

export class AnalyticsController {
    async getAnalytics(req: Request, res: Response, next: NextFunction) {
        const userID = req.query.userID as string;
        const dateString = req.query.date as string;
        const dates : Date[] = [];
        const emotionStats: { [key: string]: number[] } = {};
        const activityStats: {[key: string]: number[]} = {};

        // TODO: Decide on the tracked emotions
        emotionStats["Happiness"] = [];

        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return res.status(400).json({ error: "Invalid date format" });
        }

        if (typeof userID !== 'string') {
            return res.status(400).json({ error: "Invalid userID" });
        }

        try {
            const user = await client.db("cpen-321-journal").collection("users").findOne({ userID });
            if (!user) {
                return res.status(404).json({ error: "User not found-" });
            }
            const activities = user.activities_tracking || {};

            await unpackPastWeekStats(userID, date, activities, dates, emotionStats, activityStats);
            let summary :{activity: string, emotion: string, display: string}[];
            const emotionStatsCopy = JSON.parse(JSON.stringify(emotionStats));
            const activityStatsCopy = JSON.parse(JSON.stringify(activityStats));
            if(activities){
                summary = getWeekSummary(dates, activities, emotionStatsCopy, activityStatsCopy);
            }
            else{
                summary = [];
            }
            return res.status(200).json({emotionStats, activityStats, summary});
        } catch (error) {
            return next(error);
        }
    }
    // async createOrUpddateAnalytics(req: Request, res: Response, next: NextFunction) {
    //     const { date, userID, newEmotions, newActivities } = req.body;

    //     if (typeof userID !== 'string') {
    //         return res.status(400).json({ error: "Invalid userID" });
    //     }
    //     if (!newEmotions || !newActivities) {
    //         return res.status(400).json({ error: "newEmotions and newActivities are required" });
    //     }
        
    //     if(!(date instanceof Date)){
    //         return res.status(400).json({ error: "date is required" });
    //     }
    //     const user = getUserProfile
    // }
    // async deleteAnalytics(req: Request, res: Response, next: NextFunction) {    
    // }
}

