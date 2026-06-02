import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { AdminUsersService } from './admin-users.service';

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly jwtService: JwtService,
  ) {}

  async loginWithGoogle(idToken: string): Promise<{ accessToken: string }> {
    let email: string;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      email = ticket.getPayload()?.email ?? '';
      if (!email) throw new Error('no email in payload');
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    const admin = await this.adminUsersService.findByEmail(email);
    if (!admin) throw new ForbiddenException('Not an authorized admin');

    return { accessToken: this.jwtService.sign({ sub: admin.id, email: admin.email }) };
  }

  async loginWithPassword(email: string, password: string): Promise<{ accessToken: string }> {
    const admin = await this.adminUsersService.findByEmail(email);
    if (!admin || !admin.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return { accessToken: this.jwtService.sign({ sub: admin.id, email: admin.email }) };
  }
}
