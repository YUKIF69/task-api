import { AuthUserResponseDto } from './auth-user.response.dto.js';

export class LoginResponseDto {
  user: AuthUserResponseDto;
  accessToken: string;
}
