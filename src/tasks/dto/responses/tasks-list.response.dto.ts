import { TaskResponseDto } from './task.response.dto.js';

export class PaginationMetaDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class TasksListResponseDto {
  items: TaskResponseDto[];
  meta: PaginationMetaDto;
}
