import { error } from "console";
import { client } from "../../services";
import { ObjectFlags } from "typescript";
import { last } from "pdf-lib";

const emotionIncreaseThreshold = 0.17;
const emotionDecreaseThreshold = 0.17;
const activityIncreaseFactor = 0.9;
const activityDecreaseFactor = 0.9;


const trendMap :{[key: string]: string[]} = {
    pprelationship: ["rise", "rise"],
    nnrelationship: ["fall", "fall"],
    pnrelationship: ["rise", "fall"],
    nprelationship: ["fall", "rise"]
}

export class RelationshipMap {
    private map: Record<string, Record<string, Record<string, RelationshipLog>>>;

    constructor(activities: string[], emotions: string[]) {
        this.map = {};
        for (const activity of activities) {
            this.map[activity] = {};
            for (const emotion of emotions) {
                this.map[activity][emotion] = {
                    pprelationship: new RelationshipLog(),
                    nnrelationship: new RelationshipLog(),
                    pnrelationship: new RelationshipLog(),
                    nprelationship: new RelationshipLog(),
                };
            }
        }
    }

    addRelationCount(activity: string, emotion: string, startDate: Date, latestDate: Date, dateDelay: number, relationshipType: string): void {
        if (this.map[activity]?.[emotion]?.[relationshipType]) {
            this.map[activity][emotion][relationshipType].addLog(startDate, latestDate, dateDelay);
        }
    }

    getRelation(activity: string, emotion: string): Record<string, RelationshipLog> | undefined {
        return this.map[activity]?.[emotion];
    }
    summarizeRelationships(): {activity: string, emotion: string, display: string}[] {
        const summary: {activity: string, emotion: string, display: string}[] = [];
        for (const activity in this.map) {
            for (const emotion in this.map[activity]) {
                for (const relationship in this.map[activity][emotion]) {
                    const relationshiLog = this.map[activity][emotion][relationship];
                    if (relationshiLog.getLogs().length > 0) {
                        const summaryEntry = relationshiLog.convertSummaryEntry(activity, emotion, relationship);
                        summary.push(summaryEntry);
                        
                    }
                }
            }
        }
        return summary;
    }
}

export class RelationshipLog {
    private count: number;
    private avgDateDelay: number;
    private logs: { startDate: Date; latestDate: Date; dateDelay: number }[];

    constructor() {
        this.count = 0;
        this.avgDateDelay = 0;
        this.logs = [];
    }

    addLog(startDate: Date, latestDate: Date, dateDelay: number): void {
        this.avgDateDelay = (this.avgDateDelay * this.count + dateDelay) / (this.count + 1);
        this.logs.push({ startDate, latestDate, dateDelay });
        this.count++;
    }

    removeEarliestLog(): void {
        if (this.logs.length > 0) {
            if (this.count === 1) {
                this.avgDateDelay = 0;
            } else {
                this.avgDateDelay = (this.avgDateDelay * this.count - this.logs[0].dateDelay) / (this.count - 1);
            }
            this.logs.shift();
            this.count--;
        }
    }

    getLastLog(): { startDate: Date; latestDate: Date; dateDelay: number } | null {
        return this.logs.length > 0 ? this.logs[this.logs.length - 1] : null;
    }

    updateLogLatestDate(latestDate: Date): void {
        if (this.logs.length > 0 && this.logs[this.logs.length - 1].latestDate < latestDate) {
            this.logs[this.logs.length - 1].latestDate = latestDate;
        }
    }

    getLogs(): { startDate: Date; latestDate: Date; dateDelay: number }[] {
        return this.logs;
    }
    getAvgDateDelay(): number {
        return this.avgDateDelay;
    }
    convertSummaryEntry(activity: string, emotion: string, relationship: string): {activity: string, emotion: string, display: string} {
        const trendDescriptions : string[] = trendMap[relationship]; 
        const occurences = this.logs.length;
        if(this.avgDateDelay > 0.5){
            var firstTrend = activity;
            var firstDescription = trendDescriptions[0];
            var secondTrend = emotion;
            var secondDescription = trendDescriptions[1]
            var absAvgDateDelay = Math.abs(this.avgDateDelay);
        }
        else if(this.avgDateDelay < -0.5){
            var firstTrend = emotion;
            var secondTrend = activity;
            var firstDescription = trendDescriptions[1];
            var secondDescription = trendDescriptions[0]
            var absAvgDateDelay = Math.abs(this.avgDateDelay);
        }
        else{
            const display = `${activity} ${trendDescriptions[0]}s while ${emotion} ${trendDescriptions[1]}s at around the same time with ${occurences} notable occurence(s).`;
            return {activity, emotion, display};
        }


        const display: string = `${firstTrend} tends to ${firstDescription} while ${secondTrend} ${secondDescription}s after with an average delay of ${absAvgDateDelay} day(s) with ${occurences} notable occurence(s).`;
        return {activity, emotion, display};
    }
}

function popMapFront(map: { [key: string]: number[] }): { [key: string]: number[] } {
    let poppedMap: { [key: string]: number[] } = {};
    for(const key in map){
        poppedMap[key] = [map[key].shift()!];
    }
    return poppedMap;
}

function pushMapBack(map: {[key: string]:Number[]}, poppedMap:{ [key: string]: number[] } ): void {
    for(const key in poppedMap){
        if(map[key] === undefined){
            return error("Map keys do not match!");
        }
        map[key].push(poppedMap[key][0]);
    }
}

export function getWeekSummary(
    dates: Date[], 
    activities: { name: string, averageValue: number }[], 
    emotionStats: { [key: string]: number[] }, 
    activityStats: { [key: string]: number[] }
): {activity: string, emotion: string, display: string}[] {

    const emotionQueue : { [key: string]: number[] } = {};
    const activityQueue : { [key: string]: number[] } = {};
    const emotionTrends : { [key: string]: number[]} = {};
    const activityTrends : { [key: string]: number[]} = {};
    const activityAverages : { [key: string]: number} = {};

    Object.keys(emotionStats).forEach((emotion) => {
        emotionQueue[emotion] = [NaN, NaN, NaN, NaN, NaN, NaN, NaN];
    });
    Object.keys(activityStats).forEach((activity) => {
        activityQueue[activity] = [NaN, NaN, NaN, NaN, NaN, NaN, NaN];
    });
    Object.keys(emotionStats).forEach((emotion) => {
        emotionTrends[emotion] = [NaN, NaN, NaN, NaN, NaN, NaN];
    });
    Object.keys(activityStats).forEach((activity) => {
        activityTrends[activity] = [NaN, NaN, NaN, NaN, NaN, NaN];
    });
    const dateQueue : Date[]= [new Date(), new Date(), new Date(), new Date(), new Date(), new Date(), new Date()]; 
    for(const activity of activities){
        const activityName = (activity as {name: string}).name;
        activityAverages[activityName] = activity.averageValue;
    }

    const relationshipMap = new RelationshipMap(Object.keys(activityStats), Object.keys(emotionStats));
    for(let i = 0; i < 7; i++){
        const date = dates[i];
        const poppedEmotionStats = popMapFront(emotionStats);
        const poppedActivityStats = popMapFront(activityStats);
        popMapFront(emotionQueue);
        popMapFront(activityQueue);
        pushMapBack(emotionQueue, poppedEmotionStats);
        pushMapBack(activityQueue, poppedActivityStats);
        dateQueue.shift();
        dateQueue.push(date);
        
        deleteOldRelations(relationshipMap, dateQueue, emotionTrends, activityTrends)
        createNewRelations(relationshipMap, dateQueue, emotionQueue, activityQueue, emotionTrends, activityTrends, activityAverages);
        
    }

    const summary = relationshipMap.summarizeRelationships();
    return summary;

}

export async function unpackPastWeekStats(
    userID: string,
    date: Date,
    activities: {name: string}[],
    dates: Date[],
    emotionStats: { [key: string]: Number[] },
    activityStats: { [key: string]: Number[] }
): Promise<void> {

    for(const activity of activities){
        const activityName = (activity as {name: string}).name;
        activityStats[activityName] = [];
    }
    var prevEntry: boolean = false;
    for (let i = 6; i >= 0; i--) {
        const statDate = new Date(date);
        statDate.setDate(date.getDate() - i);
        dates.push(statDate);
        const entry = await client.db("cpen-321-journal").collection("journals").findOne({ userID: userID, date: statDate });
        if (!entry && !prevEntry) {
            for (const activity of Object.keys(activityStats)) {
                activityStats[activity].push(NaN);
            }
            for (const emotion of Object.keys(emotionStats)) {
                emotionStats[emotion].push(NaN);
            }
        }
        else if (!entry && prevEntry) {
            for (const activity of Object.keys(activityStats)) {
                activityStats[activity].push(0);
            }
            for (const emotion of Object.keys(emotionStats)) {
                emotionStats[emotion].push(emotionStats[emotion][emotionStats[emotion].length - 1]);
            }
        }
        else if(entry){
            for (const activity of Object.keys(activityStats)) {
                const activityStat = entry.stats.activities[activity] || NaN;
                activityStats[activity].push(activityStat);
            }
            for (const emotion of Object.keys(emotionStats)) {
                const emotionStat = entry.stats.emotions[emotion] || NaN;
                emotionStats[emotion].push(emotionStat);
            }
            prevEntry = true;
        }
    }
}
export function getRelType(activityTrend: number, emotionTrend: number): string {
    if(emotionTrend === 0 || activityTrend === 0){
        return ""
    }
    else if (emotionTrend > 0 && activityTrend > 0) {
        return "pprelationship";
    } else if (emotionTrend < 0 && activityTrend < 0) {
        return "nnrelationship";
    } else if (emotionTrend > 0 && activityTrend < 0) {
        return "pnrelationship";
    } else {
        return "nprelationship";
    }

}

function outputTrend(dataArr: number[], trendArr: number[], incrThreshold: number, decrThreshold: number): void {
    if (!dataArr || dataArr.length < 2) return;
  
    for (let i = 0; i < dataArr.length - 1; i++) {
        if(Number.isNaN(dataArr[i])){
            trendArr.push(0);
        } else if ((dataArr[i + 1] - dataArr[i]) > ( incrThreshold)) {
            trendArr.push(1);
        } else if (Math.abs(dataArr[i + 1] - dataArr[i]) > (decrThreshold)) {
            trendArr.push(-1);
        } else {
            trendArr.push(0);
        }
    }
  }
  
function createNewRelations(
    relationshipMap: RelationshipMap, 
    dateQueue: Date[], 
    emotionQueue: { [key: string]: number[] }, 
    activityQueue: { [key: string]: number[] }, 
    emotionTrends: { [key: string]: number[] }, 
    activityTrends: { [key: string]: number[] }, 
    activityAverages: { [key: string]: number }
): void {
    enQueueNewTrends(emotionQueue, emotionTrends, activityQueue, activityTrends, activityAverages);
    
    let ongoingActivityTrends: any[] = [];
    let ongoingEmotionTrends: any[] = [];
    let newEmotionTrends: any[] = [];
    let newActivityTrends: any[] = [];
    let recentActivityTrends: any[] = [];
    let recentEmotionTrends: any[] = [];
  
    for (const activity of Object.keys(activityTrends)) {
        const activityTrendArr = activityTrends[activity];
        const latestTrends = activityTrendArr.slice(-3);
        const latestTrend = latestTrends[latestTrends.length - 1];
        if (latestTrend === 0 || Number.isNaN(latestTrend)) {
            for (let recentIndex = 2; recentIndex < 4; recentIndex++) {
                const recentTrend = latestTrends[latestTrends.length - recentIndex];
                if (recentTrend !== 0 && !Number.isNaN(recentTrend)) {
                    if (recentIndex !== 3 && recentTrend !== latestTrends[latestTrends.length - recentIndex - 1]) {
                        recentActivityTrends.unshift([activity, recentTrend, recentIndex]);
                    } else if (recentIndex === 3) {
                        recentActivityTrends.unshift([activity, recentTrend, recentIndex]);
                    }
                }
            }
        } else {
            let ongoingIndex = 1;
            if (latestTrends[latestTrends.length - 2] !== latestTrend) {
                newActivityTrends.unshift([activity, latestTrend]);
            } else {
                while (ongoingIndex < 3 && latestTrends[latestTrends.length - ongoingIndex] === latestTrends[latestTrends.length - ongoingIndex - 1]) {
                    ongoingIndex++;
                }
                ongoingActivityTrends.unshift([activity, latestTrends[latestTrends.length - ongoingIndex], ongoingIndex]);
            }
            for (let recentIndex = ongoingIndex + 1; recentIndex < 4; recentIndex++) {
                const recentTrend = latestTrends[latestTrends.length - recentIndex];
                if (recentTrend !== 0 && !Number.isNaN(recentTrend)) {
                    if (recentIndex === 3) {
                        recentActivityTrends.unshift([activity, recentTrend, recentIndex]);
                    } else if (recentTrend !== latestTrends[latestTrends.length - recentIndex - 1]) {
                        recentActivityTrends.unshift([activity, recentTrend, recentIndex]);
                    }
                }
            }
        }
    }

    for (const emotion of Object.keys(emotionTrends)) {
        const emotionTrendArr = emotionTrends[emotion];
        const latestTrends = emotionTrendArr.slice(-3);
        const latestTrend = latestTrends[latestTrends.length - 1];
        if (latestTrend === 0 || Number.isNaN(latestTrend)) {
            for (let recentIndex = 2; recentIndex < 4; recentIndex++) {
                const recentTrend = latestTrends[latestTrends.length - recentIndex];
                if (recentTrend !== 0 && !Number.isNaN(recentTrend)) {
                    if (recentIndex !== 3 && recentTrend !== latestTrends[latestTrends.length - recentIndex - 1]) {
                        recentEmotionTrends.unshift([emotion, recentTrend, recentIndex]);
                    } else if (recentIndex === 3) {
                        recentEmotionTrends.unshift([emotion, recentTrend, recentIndex]);
                    }
                }
            }
        } else {
            let ongoingIndex = 1;
            if (latestTrends[latestTrends.length - 2] !== latestTrend) {
                newEmotionTrends.unshift([emotion, latestTrend]);
            } else {
                while (ongoingIndex < 3 && latestTrends[latestTrends.length - ongoingIndex] === latestTrends[latestTrends.length - ongoingIndex - 1]) {
                    ongoingIndex++;
                }
                ongoingEmotionTrends.unshift([emotion, latestTrends[latestTrends.length - ongoingIndex], ongoingIndex]);
            }
            for (let recentIndex = ongoingIndex + 1; recentIndex < 4; recentIndex++) {
                const recentTrend = latestTrends[latestTrends.length - recentIndex];
                if (recentTrend !== 0 && !Number.isNaN(recentTrend)) {
                    if (recentIndex === 3) {
                        recentEmotionTrends.unshift([emotion, recentTrend, recentIndex]);
                    } else if (recentTrend !== latestTrends[latestTrends.length - recentIndex - 1]) {
                        recentEmotionTrends.unshift([emotion, recentTrend, recentIndex]);
                    }
                }
            }
        }
    }
    const latestDate = dateQueue[dateQueue.length - 1];
    updateOngoingRelationships(relationshipMap, ongoingActivityTrends, ongoingEmotionTrends, recentActivityTrends, recentEmotionTrends, latestDate);
    markNewRelationships(relationshipMap, newActivityTrends, newEmotionTrends, recentActivityTrends, recentEmotionTrends, ongoingActivityTrends, ongoingEmotionTrends, latestDate);
}
  
function deleteOldRelations(
    relationshipMap: RelationshipMap, 
    dateQueue: Date[], 
    emotionTrends: { [key: string]: number[] }, 
    activityTrends: { [key: string]: number[] }
): void {
    let endingActivityTrends: any[] = [];
    let ongoingActivityTrends: any[] = [];
    let endingEmotionTrends: any[] = [];
    let ongoingEmotionTrends: any[] = [];

    for (const activity of Object.keys(activityTrends)) {
        const activityTrendArr = activityTrends[activity];
        if (activityTrendArr.length === 6) {
            const removal = activityTrendArr.shift();
            if (removal !== 0 && !Number.isNaN(removal)) {
                if (activityTrendArr[0] !== removal) {
                    endingActivityTrends.push([activity, removal]);
                    if (activityTrendArr[0] !== 0 && !Number.isNaN(activityTrendArr[0])) {
                        ongoingActivityTrends.push([activity, activityTrendArr[0]]);
                    }
                } else {
                    ongoingActivityTrends.push([activity, removal]);
                }
                for (let ongoingIndex = 1; ongoingIndex < 2; ongoingIndex++) {
                    const ongoingTrend = activityTrendArr[ongoingIndex];
                    if (ongoingTrend !== activityTrendArr[ongoingIndex - 1] && ongoingTrend !== 0 && !Number.isNaN(ongoingTrend) ){
                        ongoingActivityTrends.push([activity, ongoingTrend]);
                    }
                }
            }
        }
    }

    for (const emotion of Object.keys(emotionTrends)) {
        const emotionTrendArr = emotionTrends[emotion];
        if (emotionTrendArr.length === 6) {
            const removal = emotionTrendArr.shift();
            if (removal !== 0 && !Number.isNaN(removal)) {
                if (emotionTrendArr[0] !== removal) {
                    endingEmotionTrends.push([emotion, removal]);
                    if (emotionTrendArr[0] !== 0 && !Number.isNaN(emotionTrendArr[0])) {
                        ongoingEmotionTrends.push([emotion, emotionTrendArr[0]]);
                    }
                } else {
                    ongoingEmotionTrends.push([emotion, removal]);
                }
                for (let ongoingIndex = 1; ongoingIndex < 2; ongoingIndex++) {
                    const ongoingTrend = emotionTrendArr[ongoingIndex];
                    if (ongoingTrend !== emotionTrendArr[ongoingIndex - 1] && ongoingTrend !== 0 && !Number.isNaN(ongoingTrend)) {
                        ongoingEmotionTrends.push([emotion, ongoingTrend]);
                    }
                }
            }
        }
    }

    releaseOldRelationships(relationshipMap, endingActivityTrends, ongoingActivityTrends, endingEmotionTrends, ongoingEmotionTrends);
}

function enQueueNewTrends(
    emotionQueue : { [key: string]: number[] }, 
    emotionTrendMap: { [key: string]: number[] }, 
    activityQueue: { [key: string]: number[] }, 
    activityTrendMap:  { [key: string]: number[] }, 
    activityAverages: { [key: string]: number }
): void {
    for (const emotion of Object.keys(emotionQueue)) {
        const emotionStat = emotionQueue[emotion];
        const emotionTrendArr = emotionTrendMap[emotion];
        const latestStats = emotionStat.slice(-2);
        outputTrend(latestStats, emotionTrendArr, emotionIncreaseThreshold, emotionDecreaseThreshold);
    }
    for (const activity of Object.keys(activityQueue)) {
        const activityStat = activityQueue[activity];
        const activityTrendArr = activityTrendMap[activity];
        const activityAverage = activityAverages[activity];
        const latestStats = activityStat.slice(-2);
        const activityIncreseThreshold = activityAverage * activityIncreaseFactor;
        const activityDecreaseThreshold = activityAverage * activityDecreaseFactor;
        outputTrend(latestStats, activityTrendArr, activityIncreseThreshold, activityDecreaseThreshold);
    }
  }
  
  
function releaseOldRelationships(
    relationshipMap: RelationshipMap, 
    endingActivityTrends: any[], 
    ongoingActivityTrends: any[], 
    endingEmotionTrends: any[], 
    ongoingEmotionTrends: any[]
): void {
    for (const [endingActivity, activityTrend] of endingActivityTrends) {
        for (const [endingEmotion, emotionTrend] of endingEmotionTrends) {
            relationshipMap.getRelation(endingActivity, endingEmotion)?.[getRelType(emotionTrend, activityTrend)]?.removeEarliestLog();
        }
        for (const [ongoingEmotion, emotionTrend] of ongoingEmotionTrends) {
            relationshipMap.getRelation(endingActivity, ongoingEmotion)?.[getRelType(emotionTrend, activityTrend)]?.removeEarliestLog();
        }
    }

    for (const [endingEmotion, emotionTrend] of endingEmotionTrends) {
        for (const [ongoingActivity, activityTrend] of ongoingActivityTrends) {
            relationshipMap.getRelation(ongoingActivity, endingEmotion)?.[getRelType(emotionTrend, activityTrend)]?.removeEarliestLog();
        }
    }
}

function markNewRelationships(
    relationshipMap: RelationshipMap, 
    newActivityTrends: any[], 
    newEmotionTrends: any[], 
    recentActivityTrends: any[], 
    recentEmotionTrends: any[], 
    ongoingActivityTrends: any[], 
    ongoingEmotionTrends: any[],
    latestDate: Date
): void {
    for (const [activity, activityTrend] of newActivityTrends) {
        for (const [emotion, emotionTrend, emotionIndex] of recentEmotionTrends) {
            const startDate = new Date(latestDate);
            startDate.setDate(latestDate.getDate() - emotionIndex + 1);
            relationshipMap.addRelationCount(
                activity, 
                emotion, 
                startDate, 
                latestDate, 
                -emotionIndex + 1, 
                getRelType(emotionTrend, activityTrend)
            );
        }

        for (const [emotion, emotionTrend, emotionIndex] of ongoingEmotionTrends) {
            const startDate = new Date(latestDate);
            startDate.setDate(latestDate.getDate() - emotionIndex + 1);
            relationshipMap.addRelationCount(
                activity, 
                emotion, 
                startDate, 
                latestDate, 
                -emotionIndex + 1, 
                getRelType(emotionTrend, activityTrend)
            );
        }

        for (const [emotion, emotionTrend] of newEmotionTrends) {
            relationshipMap.addRelationCount(
                activity, 
                emotion, 
                new Date(latestDate), 
                latestDate, 
                0, 
                getRelType(emotionTrend, activityTrend)
            );
        }
    }
    // No nested loop for new emotions, new activities since it would repeat the same relationship
    for (const [emotion, emotionTrend] of newEmotionTrends) {
        for (const [activity, activityTrend, activityIndex] of recentActivityTrends) {
            const startDate = new Date(latestDate);
            startDate.setDate(latestDate.getDate() - activityIndex + 1);
            relationshipMap.addRelationCount(
                activity, 
                emotion, 
                startDate,
                latestDate, 
                activityIndex - 1, 
                getRelType(emotionTrend, activityTrend)
            );
        }

        for (const [activity, activityTrend, activityIndex] of ongoingActivityTrends) {
            const startDate = new Date(latestDate);
            startDate.setDate(latestDate.getDate() - activityIndex + 1);
            relationshipMap.addRelationCount(
                activity, 
                emotion, 
                startDate, 
                latestDate, 
                activityIndex - 1, 
                getRelType(emotionTrend, activityTrend)
            );
        }
    }
}

// For larger than 3 day "horizon" for ongoing relationships, will have to have different method for updating latest date
function updateOngoingRelationships(
    relationshipMap: RelationshipMap, 
    ongoingActivityTrends: any[], 
    ongoingEmotionTrends: any[], 
    recentActivityTrends: any[], 
    recentEmotionTrends: any[],
    latestDate: Date
): void {
    for (const [activity, activityTrend] of ongoingActivityTrends) {
        for (const [emotion, emotionTrend] of recentEmotionTrends) {
            relationshipMap.getRelation(activity, emotion)?.[getRelType(emotionTrend, activityTrend)]?.updateLogLatestDate(latestDate);
        }
    }

    for (const [emotion, emotionTrend] of ongoingEmotionTrends) {
        for (const [activity, activityTrend] of recentActivityTrends) {
            relationshipMap.getRelation(activity, emotion)?.[getRelType(emotionTrend, activityTrend)]?.updateLogLatestDate(latestDate);
        }
    }
    
    for (const [activity, activityTrend] of ongoingActivityTrends) {
        for (const [emotion, emotionTrend] of ongoingEmotionTrends) {
            relationshipMap.getRelation(activity, emotion)?.[getRelType(emotionTrend, activityTrend)]?.updateLogLatestDate(latestDate);
        }
    }
}

