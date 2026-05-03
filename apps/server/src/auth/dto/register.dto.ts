import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(30)
  username!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
