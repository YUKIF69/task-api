import { PartialType } from '@nestjs/swagger';
import { CreateTaskDto } from './create-task.dto.js';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @IsOptional()
  @IsBoolean()
  isDone?: boolean;
}
