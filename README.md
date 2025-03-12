# Valet Server

The Valet Server is a Node.js and MongoDB-powered backend for the Valet Web App. This guide helps you set up and run the server locally.

## Important Note
The Valet app has two parts: this server and a separate client. The client depends on the server, so **start the server first** when testing. See the [Valet Client README](https://github.com/juanc07/valet-client) for client setup.

## Repositories
- **Server**: [https://github.com/juanc07/valet-server](https://github.com/juanc07/valet-server)  
- **Client**: [https://github.com/juanc07/valet-client](https://github.com/juanc07/valet-client)

---

## Prerequisites

Install these tools before proceeding:

1. **Node.js**  
   - Get the latest LTS version from [nodejs.org](https://nodejs.org/).  
   - Verify:  
     ```bash
     node -v
     ```

2. **pnpm (Node Package Manager)**  
   - Install globally (not included with Node.js):  
     ```bash
     pnpm install -g pnpm
     ```
   - Check version:  
     ```bash
     pnpm -v
     ```

3. **MongoDB Community Edition**  
   - Download from [mongodb.com](https://www.mongodb.com/try/download/community).  
   - Install per your OS:  
     - **Windows**: Use the MSI installer.  
     - **MacOS**: `brew install mongodb-community` (requires Homebrew).  
     - **Linux**: E.g., `sudo apt-get install mongodb` (Ubuntu).  
   - Start MongoDB:  
     ```bash
     mongod
     ```
     (Run in a separate terminal or set up as a service.)

4. **MongoDB Compass (Optional)**  
   - Get from [mongodb.com/products/compass](https://www.mongodb.com/products/compass).  
   - Use this GUI to manage your MongoDB database.  
   - Connect to `mongodb://localhost:27017` (default).

---

## Setup Instructions

1. **Clone the Repository**  
   - Ensure Git is installed (`git --version`).  
   - Clone and enter the directory:  
     ```bash
     git clone https://github.com/juanc07/valet-server.git
     cd valet-server
     ```

2. **Install Dependencies**  
   - Install packages with pnpm:  
     ```bash
     pnpm install
     ```

3. **Configure Environment**  
   - Copy `.env.copy` to `.env`:  
     ```bash
     cp .env.copy .env
     ```
   - Edit `.env` with your settings, e.g.:  
     ```bash
     MONGODB_URI=mongodb://localhost:27017/valetdb
     PORT=3000
     TWITTER_APP_KEY=your_key
     TWITTER_APP_SECRET=your_secret
     TWITTER_BEARER_TOKEN=your_token
     OPENAI_API_KEY=your_openai_key
     ```
   - Required for Twitter and OpenAI features—get keys from [developer.twitter.com](https://developer.twitter.com) and [openai.com](https://openai.com).

---

## Running the Server

1. **Start the Server**  
   - Run the development server:  
     ```bash
     pnpm start
     ```
   - If a build is needed (e.g., for production):  
     ```bash
     pnpm run build
     pnpm run serve
     ```
   - Default port is `3000` (adjust in `.env` if needed).

2. **Test It**  
   - Ensure MongoDB is running.  
   - Test with curl:  
     ```bash
     curl http://localhost:3000/api/health
     ```
   - Or use Postman to hit endpoints (adjust based on your API routes).

---

## Notes
- **Build**: Only run `pnpm run build` if your `package.json` includes it (e.g., for TypeScript compilation). Check scripts to confirm.
- **Twitter Integration**: Agents need valid Twitter credentials in the database or `.env` for posting and streaming to work.