import cors from "cors";
import { FRONTEND_URL } from "../config";

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      FRONTEND_URL,
      "http://localhost:3001",
      "http://localhost:5173",
      undefined,
    ];
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
  credentials: true,
};

export default cors(corsOptions);