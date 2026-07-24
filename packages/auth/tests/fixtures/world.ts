import type {
  ActorContext,
  ContextSource,
  CourseResource,
  DepartmentResource,
  ProgrammeResource,
} from '../../src/index';
import { roleEffectiveAt } from '../../src/index';

/**
 * A two-department fixture world for authorisation tests.
 *
 *   dept-math    → prog-math → c-math-1 (faculty: fac-math-1)
 *                             c-math-2 (faculty: fac-math-2)
 *   dept-physics → prog-phys → c-phys-1 (faculty: fac-phys-1)
 *
 * Course status variants are created per-test via `courseWith`.
 */

export const course = (over: Partial<CourseResource> = {}): CourseResource => ({
  kind: 'course',
  courseId: 'c-math-1',
  programmeId: 'prog-math',
  departmentId: 'dept-math',
  status: 'DRAFT',
  instructorIds: ['fac-math-1'],
  ...over,
});

export const C_MATH_1 = course();
export const C_MATH_2 = course({ courseId: 'c-math-2', instructorIds: ['fac-math-2'] });
export const C_PHYS_1 = course({
  courseId: 'c-phys-1',
  programmeId: 'prog-phys',
  departmentId: 'dept-physics',
  instructorIds: ['fac-phys-1'],
});

export const PROG_MATH: ProgrammeResource = { kind: 'programme', programmeId: 'prog-math', departmentId: 'dept-math' };
export const PROG_PHYS: ProgrammeResource = { kind: 'programme', programmeId: 'prog-phys', departmentId: 'dept-physics' };
export const DEPT_MATH: DepartmentResource = { kind: 'department', departmentId: 'dept-math' };
export const DEPT_PHYS: DepartmentResource = { kind: 'department', departmentId: 'dept-physics' };

export const actor = (userId: string, roles: ActorContext['roles'], isActive = true): ActorContext => ({
  userId,
  isActive,
  roles,
});

export const facultyMath1 = actor('fac-math-1', [{ kind: 'FACULTY', departmentId: null, programmeId: null }]);
export const facultyMath2 = actor('fac-math-2', [{ kind: 'FACULTY', departmentId: null, programmeId: null }]);
export const facultyPhys1 = actor('fac-phys-1', [{ kind: 'FACULTY', departmentId: null, programmeId: null }]);
export const hodMath = actor('hod-math', [{ kind: 'HOD', departmentId: 'dept-math', programmeId: null }]);
export const coordMath = actor('coord-math', [
  { kind: 'PROGRAMME_COORDINATOR', departmentId: null, programmeId: 'prog-math' },
]);
export const iqac = actor('iqac-1', [{ kind: 'IQAC', departmentId: null, programmeId: null }]);
export const principal = actor('principal-1', [{ kind: 'PRINCIPAL', departmentId: null, programmeId: null }]);
export const admin = actor('admin-1', [{ kind: 'ADMIN', departmentId: null, programmeId: null }]);

/**
 * In-memory ContextSource for Guard tests: the same world, reachable the
 * way production reaches it (by id lookup), with role effect windows
 * honoured — so "direct API call with a guessed id" is exercised
 * end-to-end minus only the HTTP layer.
 */
export interface FakeUser {
  id: string;
  isActive: boolean;
  roles: {
    kind: ActorContext['roles'][number]['kind'];
    departmentId: string | null;
    programmeId: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }[];
}

export class FakeContextSource implements ContextSource {
  constructor(
    private readonly users: FakeUser[],
    private readonly courses: CourseResource[] = [C_MATH_1, C_MATH_2, C_PHYS_1],
    private readonly programmes: ProgrammeResource[] = [PROG_MATH, PROG_PHYS],
    private readonly departments: DepartmentResource[] = [DEPT_MATH, DEPT_PHYS],
  ) {}

  async getActor(userId: string, at: Date): Promise<ActorContext | null> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return null;
    return {
      userId: user.id,
      isActive: user.isActive,
      roles: user.roles
        .filter((role) => roleEffectiveAt(role, at))
        .map(({ kind, departmentId, programmeId }) => ({ kind, departmentId, programmeId })),
    };
  }

  async getCourse(courseId: string): Promise<CourseResource | null> {
    return this.courses.find((c) => c.courseId === courseId) ?? null;
  }

  async getProgramme(programmeId: string): Promise<ProgrammeResource | null> {
    return this.programmes.find((p) => p.programmeId === programmeId) ?? null;
  }

  async getDepartment(departmentId: string): Promise<DepartmentResource | null> {
    return this.departments.find((d) => d.departmentId === departmentId) ?? null;
  }
}
