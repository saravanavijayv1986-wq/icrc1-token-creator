import { authHandler } from "encore.dev/auth";
import { Header, APIError } from "encore.dev/api";

interface AuthParams {
  authorization?: Header<"Authorization">;
}

export interface AuthData {
  userID: string;
  principal: string;
}

const auth = authHandler<AuthParams, AuthData>(
  async (data) => {
    const token = data.authorization?.replace("Bearer ", "");
    if (!token) {
      throw APIError.unauthenticated("missing token");
    }

    // In a real implementation, this would verify the wallet signature
    // For now, we'll extract the principal from the token
    try {
      // Simple validation - in production this would verify a signed message
      if (!token.includes("-") || token.length < 20) {
        throw APIError.unauthenticated("invalid token format");
      }

      return {
        userID: token,
        principal: token,
      };
    } catch (err) {
      throw APIError.unauthenticated("invalid token", err);
    }
  }
);

export default auth;
