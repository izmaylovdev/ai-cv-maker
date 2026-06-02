import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

class GoogleLoginDto {
  idToken: string;
}

class EmailLoginDto {
  email: string;
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  googleLogin(@Body() body: GoogleLoginDto) {
    return this.authService.loginWithGoogle(body.idToken);
  }

  @Post('login')
  emailLogin(@Body() body: EmailLoginDto) {
    return this.authService.loginWithPassword(body.email, body.password);
  }
}
