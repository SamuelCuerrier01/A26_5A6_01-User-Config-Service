import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const NOMBRE_MAX_IDS_PUBLICS = 100;

export class ListerProfilsPublicsDto {
  @ApiPropertyOptional({
    example: 'user-1,user-2',
    description: `Identifiants séparés par des virgules (${NOMBRE_MAX_IDS_PUBLICS} max, doublons ignorés).`,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? [
          ...new Set(
            value
              .split(',')
              .map((id) => id.trim())
              .filter((id) => id.length > 0),
          ),
        ]
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NOMBRE_MAX_IDS_PUBLICS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(255, { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    default: true,
    description:
      'false pour omettre les avatars (rafraîchissement fréquent de la présence sans retransférer les images).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'false' ? false : value === 'true' ? true : value,
  )
  @IsBoolean()
  inclureAvatar?: boolean;
}
