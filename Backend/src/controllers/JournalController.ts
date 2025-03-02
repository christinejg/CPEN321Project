import { NextFunction, Request, Response } from "express";
import { client } from "../../services";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import axios from 'axios';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';
import { deriveKey, encryptData, decryptData } from "../utils/crypto_functions";

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
        // Derive Key for Encryption
        const key = await deriveKey(googleNumID);
    
        // Check for Existing Entry
        const existingEntry = await client.db("cpen321journal").collection("journals")
            .findOne({ date, userID });
    
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

        // const emotionAndActivityWeights = await some external API call;

        // Update or Insert Journal Entry
        const result = await client.db("cpen321journal").collection("journals")
            .updateOne(
                { date, userID },          // Filter by date and userID
                { 
                    $set: {
                        text: encryptedText, 
                        media: encryptedMedia,
                        updatedAt: new Date()
                    }
                }, 
                { upsert: true }           // Create a new document if none exists
            );
    
        res.status(200).json({ 
            message: result.upsertedCount > 0 
                ? "New journal entry created successfully with encrypted text and images!" 
                : "Existing journal entry updated successfully!"
        });
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

        console.log("entry: ", entry)

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
    
        const key = await deriveKey(googleNumID);
    
        const encryptedText = text ? await encryptData(text, key) : "";
        const encryptedMedia = media ? await Promise.all(media.map(async (item: string) => await encryptData(item, key))) : [];
    
        const result = await client.db("cpen321journal").collection("journals")
            .updateOne(
                { date, userID },
                { $set: { text: encryptedText, media: encryptedMedia } }
            );
    
        res.status(200).json({ 
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

    // async postJournalMedia(req: Request, res: Response, next: NextFunction) {
    //     const { date, userID, media } = req.body;
    
    //     if (!media || !Array.isArray(media) || media.length === 0) {
    //         return res.status(400).json({ message: "No media provided" });
    //     }

    //     const googleNumID = await getGoogleNumID(userID);
    //     if (!googleNumID) {
    //         return res.status(404).json({ error: "User not found or googleNumID is missing" });
    //     }
    
    //     const key = await deriveKey(googleNumID);
    
    //     const encryptedMedia = await Promise.all(media.map(async (item: string) => await encryptData(item, key)));
    
    //     const existing = await client.db("cpen321journal").collection("journals")
    //         .findOne({ date, userID });
    
    //     if (existing) {
    //         const updatedMedia = [...existing.media, ...encryptedMedia];
            
    //         await client.db("cpen321journal").collection("journals")
    //             .updateOne(
    //                 { date, userID },
    //                 { $set: { media: updatedMedia } }
    //             );
    //     } else {
    //         await client.db("cpen321journal").collection("journals")
    //             .insertOne({
    //                 date,
    //                 userID,
    //                 text: "",
    //                 media: encryptedMedia,
    //                 createdAt: new Date()
    //             });
    //     }

    //     console.log("encrypted: ", encryptedMedia)
    
    //     res.status(201).json({ success: true });
    // }
    
    

    // async deleteJournalMedia(req: Request, res: Response, next: NextFunction) {
    //     const { date, userID, media } = req.query;
    
    //     if (!media || typeof media !== "string") {
    //         return res.status(400).json({ message: "Invalid or no media specified for deletion" });
    //     }
    
    //     // Retrieve the journal entry
    //     const entry = await client.db("cpen321journal").collection("journals")
    //         .findOne({ date, userID });
    
    //     if (!entry) {
    //         return res.status(404).json({ message: "Journal entry not found" });
    //     }
    
    //     // Filter out the specified media
    //     const updatedMedia = entry.media.filter((item: string) => item !== media);
    
    //     // Update the document with the new media array
    //     const result = await client.db("cpen321journal").collection("journals")
    //         .updateOne(
    //             { date, userID },
    //             { $set: { media: updatedMedia } }
    //         );
    
    //     res.status(200).json({ delete_success: result.modifiedCount > 0 });
    // }
    
    

    // async getJournalMedia(req: Request, res: Response, next: NextFunction) {
    //     const { date, userID } = req.query;

    //     if (typeof userID !== 'string') {
    //         return res.status(400).json({ error: "Invalid userID" });
    //     }

    //     const googleNumID = await getGoogleNumID(userID);
    //     if (!googleNumID) {
    //         return res.status(404).json({ error: "User not found or googleNumID is missing" });
    //     }
    
    //     const key = await deriveKey(googleNumID as string);
    
    //     const entry = await client.db("cpen321journal").collection("journals")
    //         .findOne({ date, userID });
    
    //     if (!entry) {
    //         return res.status(404).json({ message: "Journal entry not found" });
    //     }
    
    //     entry.media = entry.media ? await Promise.all(entry.media.map(async (item: string) => await decryptData(item, key))) : [];
    
    //     res.status(200).json({ media: entry.media || [] });
    // }
    

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
            entry.media = entry.media ? await Promise.all(entry.media.map(async (item: string) => await decryptData(item, key))) : [];
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
                const page = pdfDoc.addPage();
                const { width, height } = page.getSize();
    
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
                    color: rgb(0, 0, 0)
                });
    
                // Embed each image
                let imageY = height - 150;
                for (const [index, mediaItem] of entry.media.entries()) {
                    // Decode Base64
                    const base64Data = mediaItem.split(',')[1];
                    const imageBuffer = Buffer.from(base64Data, 'base64');
    
                    // Embed the image
                    let embeddedImage;
                    if (mediaItem.startsWith('data:image/png')) {
                        embeddedImage = await pdfDoc.embedPng(imageBuffer);
                    } else if (mediaItem.startsWith('data:image/jpeg') || mediaItem.startsWith('data:image/jpg')) {
                        embeddedImage = await pdfDoc.embedJpg(imageBuffer);
                    }
    
                    if (embeddedImage) {
                        const imageDims = embeddedImage.scale(0.25);
    
                        // Draw the image on the page
                        page.drawImage(embeddedImage, {
                            x: 50,
                            y: imageY - imageDims.height,
                            width: imageDims.width,
                            height: imageDims.height
                        });
    
                        // Adjust Y position for next image
                        imageY -= imageDims.height + 20;
                    } else {
                        // If image is not supported, print text placeholder
                        page.drawText(`Media ${index + 1}: [Unsupported Image Format]`, {
                            x: 50,
                            y: imageY,
                            size: 12,
                            font: timesRomanFont,
                            color: rgb(1, 0, 0)
                        });
                        imageY -= 20;
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

