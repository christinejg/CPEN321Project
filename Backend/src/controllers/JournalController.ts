import { NextFunction, Request, Response } from "express";
import { client } from "../../services";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import axios from 'axios';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';
import { deriveKey, encryptData, decryptData } from "../utils/crypto_functions";
import {z} from "zod";
import errorMap from "zod/lib/locales/en";
const OPEN_API_KEY = process.env.OPEN_API_KEY || "";

if (!OPEN_API_KEY) {
    console.error("OpenAI API key is missing. Please set the OPEN_API_KEY environment variable.");
    throw new Error("OpenAI API key is missing");
}


const prompt  = "You are evaluating journal entries from someone about their day to day. The entry of the journal is freeform, but the output is set json. You are given a list of emotions to track in the form of strings. You are also given a list of objects that represent activities to track. Each object contains the name, on average how much the user does it, and the unit for how often they do it per day. First output is an overall wellbeing score, to be based on the emotion scores, this ranges 0-100. Emotions are the second output that are to be returned by you ranging from 0 to 1, for these emotions, use 0.5 as an equilibrium state and deviate from there as you see fit. And lastly you are to return how long you think, based on entry, certain activities passed were done (AS A NUMBER, NOT A STRING in the units for that activity found in 'unit' param). If you don't think enough info is present to decide on how long it was done for, fill it in with the 'averageValue' variable passed with the activity name in the same object.";
const outputStructure  = "FOLLOW THIS OUTPUT FORMAT FOR THE API TO WORK CORRECTLY FILL OUT EVERY FIELD: {overallScore: 0-100, emotion: {Joy: 0-1, Sadness: 0-1, Anger: 0-1, Fear: 0-1, Gratitude: 0-1, Neutral: 0-1, Resilience: 0-1, SelfAcceptance: 0-1, Stress: 0-1, SenseOfPurpose: 0-1}, activity: {activityName: {amount: 0}, activityName: {amount: 0}, ...}}  (NOTE IF THERE ARE NO ACTIVITIES, RETURN activty : {})";

const activitySet = new Set<string>();
export const emotionsStrings: string[] = ["Joy", "Sadness", "Anger", "Fear", "Gratitude", "Neutral", "Resilience", "SelfAcceptance", "Stress", "SenseOfPurpose"];
const emotionAndActivitySchema = z.object({
    overallScore: z.number().max(100).min(0),
    emotion: z.object({
        Joy: z.number().max(1).min(0),
        Sadness: z.number().max(1).min(0),
        Anger: z.number().max(1).min(0),
        Fear: z.number().max(1).min(0),
        Gratitude: z.number().max(1).min(0),
        Neutral: z.number().max(1).min(0),
        Resilience: z.number().max(1).min(0),
        SelfAcceptance: z.number().max(1).min(0),
        Stress: z.number().max(1).min(0),
        SenseOfPurpose: z.number().max(1).min(0),
    }),
    activity: z.record(
        z.object({
            amount : z.number().min(0),
        })
    ).superRefine((activities, ctx) => {
        Object.keys(activities).forEach((key) => {
            if (!activitySet.has(key)) {
                ctx.addIssue({
                    code: "custom",
                    message: `Invalid activity: ${key}`,
                    path: ["activity", key]
                });
            }
        });
    })
});

async function getEmbeddings(entry: string, activitiesTracking: {
    name: string, 
    averageValue: number, 
    unit: string}[] 
) : Promise<{ overallScore: number, emotions: { [key: string]: number }, activities: { [key: string]: number } }> {
    if(activitiesTracking){
        activitiesTracking.forEach((activity) => activitySet.add(activity.name));
        var activityStrings = activitiesTracking;
    }
    else{
        var activityStrings: { name: string; averageValue: number; unit: string; }[] = [];
    }

    var responseFormatCorrect = false;
    var retries = 0;
    var parsedResponse: z.infer<typeof emotionAndActivitySchema> | null = null;
    
    while(!responseFormatCorrect && retries < 3) {
        try {
            const response = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [{ 
                        role: "user", 
                        content: `${prompt} \n ${outputStructure} \n ${entry} \n Emotions: ${JSON.stringify(emotionsStrings)} \n Activities: ${JSON.stringify(activityStrings)}`
                    }],
                    max_tokens: 500, // Example parameter
                },
                {
                    headers: {
                        Authorization: `Bearer ${OPEN_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            const responseContent = response.data.choices[0].message.content;
            console.log(responseContent);
            if(!responseContent){
                throw new Error("Open API returned empty response");
            }
            let parsedContent;
            try {
                parsedContent = JSON.parse(responseContent);
            } catch (error) {
                console.error("Failed to parse response as JSON:", responseContent);
                throw new Error("API response is not valid JSON");
            }
            const parseResult = emotionAndActivitySchema.safeParse(parsedContent);
            if(parseResult.success) {
                parsedResponse = parseResult.data;
                responseFormatCorrect = true;
            } else {
                retries++;
                console.log("Error parsing response:", parseResult.error);
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error("Error making API request:", error.response || error.message);
            } else {
                console.error("Error making API request:", error);
            }
            retries++;
        }

        activitySet.clear()
    }
    if (parsedResponse) {
        console.log("SUCESS PARSED RESPONSE");
        const { overallScore, emotion, activity } = parsedResponse;
        const formattedActivities = Object.fromEntries(
            Object.entries(activity).map(([key, value]) => [key, value.amount])
        );
        return { overallScore, emotions: emotion, activities: formattedActivities };
    } else {
        throw new Error("Failed to parse response from API");
    }
}
const serverSecret = fs.readFileSync(path.join(__dirname, '../config/serverSecret.txt'), 'utf8').trim();

const isValidBase64 = (str: string) => {
    return /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(str);
};

async function getGoogleNumID(userID: string): Promise<string | null> {
    try {
        // Access the users collection
        const collection = client.db("cpen321journal").collection("users");

        // Find the user by userID
        const user = await collection.findOne({ userID });

        // Check if user exists and return googleNumID
        if (user && user.googleNumID) {
            return user.googleNumID;
        } else {
            return ""; // If no user or googleNumID is found
        }
    } catch (error) {
        console.error("Error retrieving googleNumID:", error);
        throw error;
    }
}

export class JournalController {
    async postJournal(req: Request, res: Response, next: NextFunction) {
        const { date, userID, text, media } = req.body;

        const googleNumID = await getGoogleNumID(userID);
        if (!googleNumID) {
            return res.status(404).json({ error: "User not found or googleNumID is missing" });
        }
        // Fetch user from the database
        let user;
        try {
            user = await client.db("cpen321journal").collection("users").findOne({ userID });
        } catch (error) {
            console.error("Database error fetching user:", error);
            return res.status(500).json({ error: "Database error while retrieving user" });
        }

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // Derive Key for Encryption
        const key = await deriveKey(googleNumID);
    
        // Fetch existing journal entry
        let existingEntry;
        try {
            existingEntry = await client.db("cpen321journal").collection("journals").findOne({ date, userID });
        } catch (error) {
            console.error("Database error fetching journal entry:", error);
            return res.status(500).json({ error: "Database error while retrieving journal entry" });
        }
    
        // Encrypt Text
        let encryptedText;
        if (text) {
            encryptedText = await encryptData(text, key);
        } else {
            // Keep Existing Text if not provided
            encryptedText = existingEntry ? existingEntry.text : "";
        }
    
        // Encrypt Media
        let encryptedMedia;
        if (media) {
            encryptedMedia = await Promise.all(media.map(async (item: string) => await encryptData(item, key)));
        } else {
            // Keep Existing Media if not provided
            encryptedMedia = existingEntry ? existingEntry.media : [];
        }
        var entryStats: { overallScore: number ; emotions: {[key: string]: number}; activities: { [key: string]: number }; } = { overallScore: 0, emotions: {}, activities: {} };
        if(text){
            entryStats = await getEmbeddings(text, user.activities_tracking);
        }


        // Update or Insert Journal Entry
        try {
            const result = await client.db("cpen321journal").collection("journals")
                .updateOne(
                    { date, userID },
                    { 
                        $set: {
                            text: encryptedText, 
                            media: encryptedMedia,
                            stats: entryStats,
                            updatedAt: new Date()
                        }
                    }, 
                    { upsert: true }
                );

            return res.status(200).json({ activities: entryStats.activities,
                message: result.upsertedCount > 0 
                    ? "New journal entry created successfully with encrypted text and images!" 
                    : "Existing journal entry updated successfully!"
            });
        } catch (error) {
            console.error("Database error updating journal entry:", error);
            return res.status(500).json({ error: "Database error while saving journal entry" });
        }
    }
    

    async getJournal(req: Request, res: Response, next: NextFunction) {
        const { date, userID } = req.query;

        if (typeof userID !== 'string') {
            return res.status(400).json({ error: "Invalid userID" });
        }

        const googleNumID = await getGoogleNumID(userID);
        if (!googleNumID) {
            return res.status(404).json({ error: "User not found or googleNumID is missing" });
        }

        const key = await deriveKey(googleNumID as string);

        const entry = await client.db("cpen321journal").collection("journals")
            .findOne({ date, userID });

        if (entry) {
            entry.text = entry.text ? await decryptData(entry.text, key) : "";
            entry.media = entry.media ? await Promise.all(entry.media.map(async (item: string) => await decryptData(item, key))) : [];
        }

        res.status(200).json({
            journal: entry ? { text: entry.text, media: entry.media } : { text: "", media: [] }
        });
    }

    

    async putJournal(req: Request, res: Response, next: NextFunction) {
        const { date, userID, text, media } = req.body;

        const googleNumID = await getGoogleNumID(userID);
        if (!googleNumID) {
            return res.status(404).json({ error: "User not found or googleNumID is missing" });
        }
        const user = await client.db("cpen321journal").collection("users").findOne({ userID });
        if(!user){
            return res.status(404).json({ error: "User not found" });
        }
        
        const key = await deriveKey(googleNumID);
        var entryStats: { overallScore: number ; emotions: {[key: string]: number}; activities: { [key: string]: number }; } = { overallScore: 0, emotions: {}, activities: {} };
        if(text){
            entryStats = await getEmbeddings(text, user.activities_tracking);
        }

        const encryptedText = text ? await encryptData(text, key) : "";
        const encryptedMedia = media ? await Promise.all(media.map(async (item: string) => await encryptData(item, key))) : [];
    
        const result = await client.db("cpen321journal").collection("journals")
            .updateOne(
                { date, userID },
                { $set: { text: encryptedText, media: encryptedMedia , stats: entryStats} }
            );
    
            res.status(200).json({ activities: entryStats.activities,
            update_success: result.modifiedCount > 0 
        });
    }
    
    

    async deleteJournal(req: Request, res: Response, next: NextFunction) {
        const { date, userID } = req.query;
        
        const result = await client.db("cpen321journal").collection("journals")
            .deleteOne({ date, userID });

        res.status(200).json({ 
            delete_success: result.deletedCount > 0 
        });
    }


    async getJournalFile(req: Request, res: Response, next: NextFunction) {
        const { userID, format } = req.query;
    
        if (typeof userID !== 'string') {
            return res.status(400).json({ error: "Invalid userID" });
        }
    
        const googleNumID = await getGoogleNumID(userID);
        if (!googleNumID) {
            return res.status(404).json({ error: "User not found or googleNumID is missing" });
        }
    
        // Validate Format
        if (!['pdf', 'csv'].includes(format as string)) {
            return res.status(400).json({ message: "Invalid format. Only 'pdf' or 'csv' are accepted." });
        }
    
        // Derive Key
        const key = await deriveKey(googleNumID as string);
    
        // Fetch All Journal Entries for the User
        const journals = await client.db("cpen321journal").collection("journals")
            .find({ userID }).toArray();
    
        if (!journals || journals.length === 0) {
            return res.status(404).json({ message: "No journal entries found for this user." });
        }
    
        // Decrypt Text and Media
        for (const entry of journals) {
            entry.text = entry.text ? await decryptData(entry.text, key) : "";
            entry.media = entry.media && Array.isArray(entry.media)
                ? await Promise.all(entry.media.map(async (item: string) => {
                    try {
                        return await decryptData(item, key);
                    } catch (error) {
                        console.error(`Error decrypting media: ${error}`);
                        return null; // Skip faulty media
                    }
                })).then(items => items.filter(Boolean)) // Remove null values
                : [];
        }
    
        // Generate File Based on Format
        const filename = `${uuidv4()}.${format}`;
        const filePath = path.join(__dirname, `../../public/${filename}`);
    
        if (format === 'csv') {
            // Generate CSV
            const json2csvParser = new Parser({ fields: ['date', 'text', 'media'] });
            const csv = json2csvParser.parse(journals);
            fs.writeFileSync(filePath, csv);
    
        } else if (format === 'pdf') {
            const pdfDoc = await PDFDocument.create();
            const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    
            for (const entry of journals) {
                let page = pdfDoc.addPage();
                let { width, height } = page.getSize();
                let imageY = height - 50; // Initial Y position for images
    
                // Add Date and Text
                page.drawText(`Date: ${entry.date}`, {
                    x: 50,
                    y: height - 50,
                    size: 20,
                    font: timesRomanFont,
                    color: rgb(0, 0, 0)
                });
    
                page.drawText(`Text: ${entry.text}`, {
                    x: 50,
                    y: height - 100,
                    size: 15,
                    font: timesRomanFont,
                    color: rgb(0, 0, 0),
                    maxWidth: width - 100
                });
    
                imageY -= 50; // Adjust Y position after text
    
                // Add extra spacing between text and images
                const textSpacing = 30; // Extra space after text before images
                const imageSpacing = 20; // Space between images

                // Ensure there is space before starting images
                imageY -= textSpacing;

                // Embed each image
                for (const [index, mediaItem] of entry.media.entries()) {
                    if (!mediaItem || typeof mediaItem !== 'string') {
                        console.error(`Invalid mediaItem: ${mediaItem}`);
                        continue; // Skip this media item
                    }

                    try {
                        let imageBuffer;
                        let embeddedImage;

                        // Check if it's a raw Base64 string (no data URL prefix)
                        if (!mediaItem.startsWith("data:image")) {
                            const assumedMimeType = "image/png";
                            imageBuffer = Buffer.from(mediaItem, "base64");
                            embeddedImage = await pdfDoc.embedPng(imageBuffer);
                        } else {
                            // Extract MIME type and Base64 data
                            const [meta, base64Data] = mediaItem.split(",");
                            if (!base64Data) {
                                console.error(`Base64 data missing in mediaItem: ${mediaItem}`);
                                continue;
                            }

                            imageBuffer = Buffer.from(base64Data, "base64");

                            if (meta.includes("image/png")) {
                                embeddedImage = await pdfDoc.embedPng(imageBuffer);
                            } else if (meta.includes("image/jpeg") || meta.includes("image/jpg")) {
                                embeddedImage = await pdfDoc.embedJpg(imageBuffer);
                            } else {
                                console.warn(`Unsupported image format: ${meta}`);
                                continue;
                            }
                        }

                        if (embeddedImage) {
                            const { width: imgWidth, height: imgHeight } = embeddedImage.scale(1); // Get original dimensions

                            // Max dimensions for the image (so it doesn't take over the entire page)
                            const maxWidth = width - 100; // Leave some margin on the sides
                            const maxHeight = height / 3; // Limit to 1/3 of the page height

                            // Calculate the new dimensions while maintaining aspect ratio
                            let newWidth = imgWidth;
                            let newHeight = imgHeight;

                            if (newWidth > maxWidth) {
                                const scaleFactor = maxWidth / newWidth;
                                newWidth *= scaleFactor;
                                newHeight *= scaleFactor;
                            }

                            if (newHeight > maxHeight) {
                                const scaleFactor = maxHeight / newHeight;
                                newWidth *= scaleFactor;
                                newHeight *= scaleFactor;
                            }

                            // Check if we need a new page
                            if (imageY - newHeight < 50) {
                                page = pdfDoc.addPage();
                                ({ width, height } = page.getSize());
                                imageY = height - 50;
                            }

                            // Draw the resized image on the page
                            page.drawImage(embeddedImage, {
                                x: 50,
                                y: imageY - newHeight,
                                width: newWidth,
                                height: newHeight
                            });

                            // Adjust Y position for next image
                            imageY -= newHeight + imageSpacing;
                        }
                    } catch (error) {
                        console.error(`Error embedding image: ${error}`);
                        continue;
                    }
                }


            }
    
            const pdfBytes = await pdfDoc.save();
            fs.writeFileSync(filePath, pdfBytes);
        }
    
        // Return Download URL
        const downloadURL = `${req.protocol}://${req.get('host')}/public/${filename}`;
        res.status(200).json({ filename, downloadURL });
    }    
    
    
}

