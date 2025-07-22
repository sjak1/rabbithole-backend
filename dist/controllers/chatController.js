"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLLMResponse = exports.getBranchesForUser = exports.getUser = exports.createBranch = exports.generateBranchTitle = exports.setBranchTitle = exports.deleteBranch = exports.getBranchParent = exports.setBranchParent = exports.appendMessageToBranch = exports.getMessagesForBranch = void 0;
exports.default = getCompletion;
const client_1 = require("@prisma/client");
const express_1 = require("@clerk/express");
require("dotenv/config");
const openai_1 = __importDefault(require("openai"));
const openai = new openai_1.default({
    apiKey: process.env.OPENAI_API_KEY,
});
async function getCompletion({ messages }) {
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            ...messages,
        ],
    });
    return completion;
}
const prisma = new client_1.PrismaClient();
const getMessagesForBranch = async (req, res) => {
    const branchId = req.params.branchId;
    try {
        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { messages: true }
        });
        if (!branch) {
            res.status(404).json({ error: "Branch not found" });
            return;
        }
        res.json(branch.messages ?? []);
    }
    catch (err) {
        console.error("Error fetching messages:", err);
        res.status(500).json({ error: "Failed to fetch messages" });
        return;
    }
};
exports.getMessagesForBranch = getMessagesForBranch;
const appendMessageToBranch = async (req, res) => {
    const branchId = req.params.branchId;
    const newMessage = req.body.message; // should be { role: 'user' | 'assistant' | 'system', content: '...' }
    try {
        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { messages: true }
        });
        const currentMessages = Array.isArray(branch?.messages) ? branch.messages : [];
        const updatedMessages = [...currentMessages, newMessage];
        const updatedBranch = await prisma.branch.update({
            where: { id: branchId },
            data: { messages: updatedMessages }
        });
        res.json(updatedBranch.messages);
    }
    catch (err) {
        console.error('Failed to append message:', err);
        res.status(500).json({ error: 'Failed to append message' });
        return;
    }
};
exports.appendMessageToBranch = appendMessageToBranch;
const setBranchParent = async (req, res) => {
    const { childId, parentId } = req.body;
    const updatedBranch = await prisma.branch.update({
        where: { id: childId },
        data: { parentId: parentId }
    });
    res.json(updatedBranch);
    return;
};
exports.setBranchParent = setBranchParent;
const getBranchParent = async (req, res) => {
    const branchId = req.params.branchId;
    const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        include: { parent: true }
    });
    res.json(branch?.parent);
    return;
};
exports.getBranchParent = getBranchParent;
const deleteBranch = async (req, res) => {
    const branchId = req.params.branchId;
    const deleteBranch = await prisma.branch.delete({
        where: {
            id: branchId
        }
    });
    res.json(deleteBranch);
    return;
};
exports.deleteBranch = deleteBranch;
const setBranchTitle = async (req, res) => {
    try {
        const { branchId } = req.params;
        const { title } = req.body;
        const updatedBranch = await prisma.branch.update({
            where: { id: branchId },
            data: { name: title }
        });
        res.json(updatedBranch);
    }
    catch (err) {
        console.error('Error setting branch title:', err);
        res.status(500).json({ error: 'Failed to set branch title' });
        return;
    }
};
exports.setBranchTitle = setBranchTitle;
const generateBranchTitle = async (req, res) => {
    try {
        const { branchId } = req.params;
        const { userId } = (0, express_1.getAuth)(req);
        if (!userId) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { messages: true }
        });
        if (!branch || !Array.isArray(branch.messages) || branch.messages.length === 0) {
            res.status(404).json({ error: "Branch not found or has no messages" });
            return;
        }
        // Take the first 4 messages to generate a title
        const messagesForTitle = branch.messages.slice(0, 4);
        const titlePrompt = {
            role: 'system',
            content: "Summarize the following conversation in 5 words or less to be used as a title. Be concise and descriptive. Do not use quotes."
        };
        const response = await getCompletion({ messages: [titlePrompt, ...messagesForTitle] });
        const title = response.choices[0]?.message?.content?.trim().replace(/["']/g, "") ?? "New Title";
        // Deduct credits for title generation
        const costPerMillionInputTokens = 0.15;
        const costPerMillionOutputTokens = 0.60;
        const promptTokens = response.usage?.prompt_tokens ?? 0;
        const completionTokens = response.usage?.completion_tokens ?? 0;
        const cost = (promptTokens / 1000000) * costPerMillionInputTokens +
            (completionTokens / 1000000) * costPerMillionOutputTokens;
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: cost } },
        });
        const updatedBranch = await prisma.branch.update({
            where: { id: branchId },
            data: { name: title }
        });
        const updatedUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true }
        });
        res.json({ updatedBranch, remainingCredits: updatedUser?.credits });
    }
    catch (err) {
        console.error('Error generating branch title:', err);
        res.status(500).json({ error: 'Failed to generate branch title' });
        return;
    }
};
exports.generateBranchTitle = generateBranchTitle;
const createBranch = async (req, res) => {
    try {
        const { branchId, name = 'New Branch' } = req.body;
        console.log('Attempting to create branch:', { branchId, name });
        // Get authenticated user
        const { userId } = (0, express_1.getAuth)(req);
        if (!userId) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        // Ensure user exists in local DB
        const clerkUser = await express_1.clerkClient.users.getUser(userId);
        const email = clerkUser.emailAddresses[0]?.emailAddress || "";
        await prisma.user.upsert({
            where: { id: userId },
            update: { email },
            create: { id: userId, email }
        });
        const branch = await prisma.branch.create({
            data: {
                id: branchId,
                name,
                user: { connect: { id: userId } }
            }
        });
        res.json(branch);
    }
    catch (err) {
        if (err instanceof Error) {
            console.error('Error creating branch:', {
                message: err.message,
                code: err instanceof client_1.Prisma.PrismaClientKnownRequestError ? err.code : undefined,
                stack: err.stack
            });
        }
        res.status(500).json({ error: 'Failed to create branch' });
        return;
    }
};
exports.createBranch = createBranch;
const getUser = async (req, res) => {
    const { userId } = (0, express_1.getAuth)(req);
    if (!userId) {
        res.status(401).json({ error: 'Not signed in' });
        return;
    }
    try {
        let user = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            const clerkUser = await express_1.clerkClient.users.getUser(userId);
            const email = clerkUser.emailAddresses[0]?.emailAddress || "";
            user = await prisma.user.upsert({
                where: { id: userId },
                update: { email, name: clerkUser.firstName },
                create: { id: userId, email, name: clerkUser.firstName },
            });
        }
        res.json(user);
    }
    catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
};
exports.getUser = getUser;
const getBranchesForUser = async (req, res) => {
    const { userId } = (0, express_1.getAuth)(req);
    if (!userId) {
        res.status(401).json({ error: 'Not signed in' });
        return;
    }
    try {
        const branches = await prisma.branch.findMany({
            where: { userId },
            select: {
                id: true,
                name: true,
                parentId: true,
                messages: true
            }
        });
        res.json(branches);
    }
    catch (err) {
        console.error('Error fetching branches:', err);
        res.status(500).json({ error: 'Failed to fetch branches' });
    }
};
exports.getBranchesForUser = getBranchesForUser;
const getLLMResponse = async (req, res) => {
    const { messages } = req.body;
    const { userId } = (0, express_1.getAuth)(req);
    if (!userId) {
        res.status(401).json({ error: 'Not signed in' });
        return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    if (user.credits <= 0) {
        res.status(403).json({ error: "Out of credits" });
        return;
    }
    try {
        // Set up Server-Sent Events
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': process.env.CLIENT_ORIGIN || 'http://localhost:3000',
            'Access-Control-Allow-Credentials': 'true',
        });
        const stream = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                ...messages,
            ],
            stream: true,
        });
        let fullContent = '';
        let promptTokens = 0;
        let completionTokens = 0;
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullContent += content;
                res.write(`data: ${JSON.stringify({ content, type: 'content' })}\n\n`);
            }
            // Track usage if available
            if (chunk.usage) {
                promptTokens = chunk.usage.prompt_tokens || 0;
                completionTokens = chunk.usage.completion_tokens || 0;
            }
        }
        // Calculate cost and deduct credits
        const costPerMillionInputTokens = 0.15;
        const costPerMillionOutputTokens = 0.60;
        const cost = (promptTokens / 1000000) * costPerMillionInputTokens +
            (completionTokens / 1000000) * costPerMillionOutputTokens;
        await prisma.user.update({
            where: { id: userId },
            data: {
                credits: { decrement: cost },
            },
        });
        const updatedUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true }
        });
        // Send final message with credits
        res.write(`data: ${JSON.stringify({
            type: 'complete',
            credits: updatedUser?.credits ?? 0,
            fullContent
        })}\n\n`);
        res.end();
    }
    catch (err) {
        console.error("Error in getLLMResponse:", err);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'LLM failed' })}\n\n`);
        res.end();
    }
};
exports.getLLMResponse = getLLMResponse;
