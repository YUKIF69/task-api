import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TasksService } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { TasksQueryDto } from './dto/tasks-query.dto.js';
import { GetUser } from '../auth/decorators/get-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TasksListResponseDto } from './dto/responses/tasks-list.response.dto.js';
import { TaskResponseDto } from './dto/responses/task.response.dto.js';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiBadRequestResponse({
  description: 'Invalid request data',
})
@ApiUnauthorizedResponse({
  description: 'Unauthorized',
})
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @ApiOkResponse({ type: TasksListResponseDto })
  @Get()
  getAllTasks(
    @GetUser('userId') userId: string,
    @Query() query: TasksQueryDto,
  ) {
    return this.tasksService.getAllTasks(query, userId);
  }

  @ApiCreatedResponse({ type: TaskResponseDto })
  @Post()
  createTask(@GetUser('userId') userId: string, @Body() dto: CreateTaskDto) {
    return this.tasksService.createTask(dto, userId);
  }

  @ApiNotFoundResponse({
    description: 'Task not found',
  })
  @ApiOkResponse({ type: TaskResponseDto })
  @Get(':id')
  getTaskById(
    @GetUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.getTaskById(id, userId);
  }

  @ApiNotFoundResponse({
    description: 'Task not found',
  })
  @ApiOkResponse({ type: TaskResponseDto })
  @Patch(':id')
  updateTask(
    @GetUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.updateTask(id, dto, userId);
  }

  @ApiNotFoundResponse({
    description: 'Task not found',
  })
  @ApiOkResponse({ type: TaskResponseDto })
  @Delete(':id')
  deleteTask(
    @GetUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.deleteTask(id, userId);
  }
}
