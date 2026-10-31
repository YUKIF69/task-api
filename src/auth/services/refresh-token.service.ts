import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class RefreshTokenService {
  generate(): string {
    return randomBytes(64).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
