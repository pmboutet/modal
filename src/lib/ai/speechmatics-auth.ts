/**
 * Authentication utilities for Speechmatics Voice Agent
 */

import { devError } from '@/lib/utils';

export class SpeechmaticsAuth {
  private speechmaticsJWT: string | null = null;
  private jwtExpiry: number = 0;
  private speechmaticsApiKey: string | null = null;

  async authenticate(): Promise<string> {
    // Check if we have a valid JWT token
    if (this.speechmaticsJWT && Date.now() < this.jwtExpiry) {
      return this.speechmaticsJWT;
    }
    
    try {
      // Try to get a JWT token first (for direct connection without proxy)
      let response = await fetch('/api/speechmatics-jwt', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const jwtData = await response.json();
        if (jwtData.jwt) {
          this.speechmaticsJWT = jwtData.jwt;
          // Set expiry to 90% of TTL to be safe
          this.jwtExpiry = Date.now() + (jwtData.ttl * 900);
          return this.speechmaticsJWT!; // Non-null assertion: we just set it above
        }
      }

      // Fallback to API key if JWT generation fails (for local development with proxy)
      response = await fetch('/api/speechmatics-token', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Speechmatics authentication failed: ${errorText}`);
      }

      const data = await response.json();
      this.speechmaticsApiKey = data.apiKey;
      if (!this.speechmaticsApiKey) {
        throw new Error('Failed to get Speechmatics API key');
      }
      return this.speechmaticsApiKey;
    } catch (error) {
      devError('[Speechmatics] ❌ Authentication error:', error);
      throw error;
    }
  }

  async getElevenLabsApiKey(): Promise<string> {
    try {
      const response = await fetch('/api/elevenlabs-token', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get ElevenLabs API key: ${errorText}`);
      }

      const data = await response.json();
      const apiKey = data.apiKey;
      if (!apiKey) {
        throw new Error('Failed to get ElevenLabs API key');
      }
      return apiKey;
    } catch (error) {
      devError('[Speechmatics] ❌ Error getting ElevenLabs API key:', error);
      throw error;
    }
  }

  getJWT(): string | null {
    return this.speechmaticsJWT;
  }

  getApiKey(): string | null {
    return this.speechmaticsApiKey;
  }

  hasJWT(): boolean {
    return this.speechmaticsJWT !== null && Date.now() < this.jwtExpiry;
  }
}

