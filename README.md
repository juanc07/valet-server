# Valet Server

The Valet Server is a Node.js and MongoDB-powered backend for the Valet Web App. This guide will help you set up and run the server on your machine.

## Important Note
The Valet app consists of two parts: this server and a separate client. The client relies on the server, so **always start the server first** when testing. For client setup, refer to the [Valet Client README](https://github.com/juanc07/valet-client).

## Repositories
- **Server**: [https://github.com/juanc07/valet-server](https://github.com/juanc07/valet-server)  
- **Client**: [https://github.com/juanc07/valet-client](https://github.com/juanc07/valet-client)

---

## Prerequisites

Before you begin, install the following tools:

1. **Node.js**  
   - Install the latest LTS version from [nodejs.org](https://nodejs.org/).  
   - Confirm it’s working:  
     ```bash
     node -v
     ```

2. **npm (Node Package Manager)**  
   - Included with Node.js, but update it globally for the latest version:  
     ```bash
     npm install -g npm
     ```
   - Verify:  
     ```bash
     npm -v
     ```

3. **MongoDB Community Edition**  
   - Download from [mongodb.com](https://www.mongodb.com/try/download/community).  
   - Install based on your OS:  
     - **Windows**: Use the MSI installer.  
     - **MacOS**: Run `brew install mongodb-community` (requires Homebrew).  
     - **Linux**: Example for Ubuntu: `sudo apt-get install mongodb`.  
   - Start MongoDB:  
     ```bash
     mongod
     ```
     (Run in a separate terminal or configure it as a background service.)

4. **MongoDB Compass (Optional)**  
   - Download from [mongodb.com/products/compass](https://www.mongodb.com/products/compass).  
   - Use this GUI to inspect or manage your MongoDB database.  
   - Connect to `mongodb://localhost:27017` (default) or your custom URI.

---

## Setup Instructions

Follow these steps to set up the server:

1. **Clone the Repository**  
   - Ensure Git is installed (`git --version`).  
   - Clone the server:  
     ```bash
     git clone https://github.com/juanc07/valet-server.git
     cd valet-server
     ```

2. **Install Dependencies**  
   - Install the required npm packages:  
     ```bash
     npm install
     ```

3. **Build the Project (Optional)**  
   - If a build step is needed (check `package.json`), run:  
     ```bash
     npm run build
     ```
     (Skip this if not applicable—most servers don’t require it.)

---

## Running the Server

1. **Start the Server**  
   - Launch the server:  
     ```bash
     npm run start
     ```
   - Default port is typically `3000`—check your server config or `.env`.

2. **Test It**  
   - Use Postman or curl to test server APIs (e.g., `http://localhost:3000/api`).  
   - Ensure MongoDB is running, or the server won’t connect.

---

## Configuration
- **Environment Variables**: Look for a `.env.copy` file in the repo. Create a `.env` file in `valet-server` with settings like:  
  ```bash
  MONGODB_URI=mongodb://localhost:27017/valetdb
  PORT=3000