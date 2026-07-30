import type { PrismaClient } from '@copo/db';

/** A role assignment effective at the instant under consideration. */
export interface EffectiveRole {
  kind: 'ADMIN' | 'PRINCIPAL' | 'DEAN' | 'IQAC' | 'HOD' | 'FACULTY';
  /** HOD only; every other role is institution-wide and leaves this null. */
  departmentId: string | null;
}

export interface ActorContext {
  userId: string;
  isActive: boolean;
  /** Only assignments whose [effectiveFrom, effectiveTo) window contains `at`. */
  roles: EffectiveRole[];
}

export interface CourseResource {
  kind: 'course';
  courseId: string;
  programmeId: string;
  departmentId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'LOCKED';
  /** Users assigned to the course (CourseInstructor). */
  instructorIds: readonly string[];
}

export interface ProgrammeResource {
  kind: 'programme';
  programmeId: string;
  departmentId: string;
}

export interface DepartmentResource {
  kind: 'department';
  departmentId: string;
}

export type ResourceContext = CourseResource | ProgrammeResource | DepartmentResource;

/**
 * How the guard learns about actors and resources. An interface so the
 * authorisation path is fully testable without a database; production
 * uses PrismaContextSource. Loaders return null for unknown ids — the
 * guard turns that into a denial, never an allow and never a 500.
 */
export interface ContextSource {
  getActor(userId: string, at: Date): Promise<ActorContext | null>;
  getCourse(courseId: string): Promise<CourseResource | null>;
  getProgramme(programmeId: string): Promise<ProgrammeResource | null>;
  getDepartment(departmentId: string): Promise<DepartmentResource | null>;
}

/** True when the role window contains `at`. */
export function roleEffectiveAt(role: { effectiveFrom: Date; effectiveTo: Date | null }, at: Date): boolean {
  return role.effectiveFrom.getTime() <= at.getTime() && (role.effectiveTo === null || role.effectiveTo.getTime() > at.getTime());
}

export class PrismaContextSource implements ContextSource {
  constructor(private readonly prisma: PrismaClient) {}

  async getActor(userId: string, at: Date): Promise<ActorContext | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        roles: { select: { kind: true, departmentId: true, effectiveFrom: true, effectiveTo: true } },
      },
    });
    if (!user) return null;
    return {
      userId: user.id,
      isActive: user.isActive,
      roles: user.roles.filter((role) => roleEffectiveAt(role, at)).map(({ kind, departmentId }) => ({ kind, departmentId })),
    };
  }

  async getCourse(courseId: string): Promise<CourseResource | null> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        status: true,
        batch: { select: { programmeId: true, programme: { select: { departmentId: true } } } },
        instructors: { select: { userId: true } },
      },
    });
    if (!course) return null;
    return {
      kind: 'course',
      courseId: course.id,
      programmeId: course.batch.programmeId,
      departmentId: course.batch.programme.departmentId,
      status: course.status,
      instructorIds: course.instructors.map((i) => i.userId),
    };
  }

  async getProgramme(programmeId: string): Promise<ProgrammeResource | null> {
    const programme = await this.prisma.programme.findUnique({
      where: { id: programmeId },
      select: { id: true, departmentId: true },
    });
    return programme ? { kind: 'programme', programmeId: programme.id, departmentId: programme.departmentId } : null;
  }

  async getDepartment(departmentId: string): Promise<DepartmentResource | null> {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    return department ? { kind: 'department', departmentId: department.id } : null;
  }
}
