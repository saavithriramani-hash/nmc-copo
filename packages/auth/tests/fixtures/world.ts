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
 *   dept-math    → prog-math     → c-math-1 (faculty: fac-math-1)
 *                                  c-math-2 (faculty: fac-math-2)
 *                → prog-math-msc  (second programme, no courses)
 *   dept-physics → prog-phys     → c-phys-1 (faculty: fac-phys-1)
 *
 * dept-math deliberately owns TWO programmes: since the §2 revision of
 * 30 Jul 2026 removed the programme coordinator, the HoD is responsible
 * for every programme of their department, and a one-programme
 * department could not tell that apart from per-programme scoping.
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
  // A theory paper unless a test says otherwise, which is what every
  // course in the college was before CR-3.
  isLaboratory: false,
  ...over,
});

export const C_MATH_1 = course();
export const C_MATH_2 = course({ courseId: 'c-math-2', instructorIds: ['fac-math-2'] });
/** CR-3: a practical paper — its external examination belongs to the department. */
export const C_MATH_LAB = course({ courseId: 'c-math-lab', isLaboratory: true });
export const C_PHYS_1 = course({
  courseId: 'c-phys-1',
  programmeId: 'prog-phys',
  departmentId: 'dept-physics',
  instructorIds: ['fac-phys-1'],
});

export const PROG_MATH: ProgrammeResource = { kind: 'programme', programmeId: 'prog-math', departmentId: 'dept-math' };
export const PROG_MATH_MSC: ProgrammeResource = {
  kind: 'programme',
  programmeId: 'prog-math-msc',
  departmentId: 'dept-math',
};
export const PROG_PHYS: ProgrammeResource = { kind: 'programme', programmeId: 'prog-phys', departmentId: 'dept-physics' };
export const DEPT_MATH: DepartmentResource = { kind: 'department', departmentId: 'dept-math' };
export const DEPT_PHYS: DepartmentResource = { kind: 'department', departmentId: 'dept-physics' };

export const actor = (userId: string, roles: ActorContext['roles'], isActive = true): ActorContext => ({
  userId,
  isActive,
  roles,
});

export const facultyMath1 = actor('fac-math-1', [{ kind: 'FACULTY', departmentId: null }]);
export const facultyMath2 = actor('fac-math-2', [{ kind: 'FACULTY', departmentId: null }]);
export const facultyPhys1 = actor('fac-phys-1', [{ kind: 'FACULTY', departmentId: null }]);
export const hodMath = actor('hod-math', [{ kind: 'HOD', departmentId: 'dept-math' }]);
export const dean = actor('dean-1', [{ kind: 'DEAN', departmentId: null }]);
export const iqac = actor('iqac-1', [{ kind: 'IQAC', departmentId: null }]);
export const principal = actor('principal-1', [{ kind: 'PRINCIPAL', departmentId: null }]);
export const admin = actor('admin-1', [{ kind: 'ADMIN', departmentId: null }]);
/** CR-3: the Controller of Examinations — institution-wide, like the Dean. */
export const coe = actor('coe-1', [{ kind: 'COE', departmentId: null }]);

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
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }[];
}

export class FakeContextSource implements ContextSource {
  constructor(
    private readonly users: FakeUser[],
    private readonly courses: CourseResource[] = [C_MATH_1, C_MATH_2, C_PHYS_1],
    private readonly programmes: ProgrammeResource[] = [PROG_MATH, PROG_MATH_MSC, PROG_PHYS],
    private readonly departments: DepartmentResource[] = [DEPT_MATH, DEPT_PHYS],
  ) {}

  async getActor(userId: string, at: Date): Promise<ActorContext | null> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return null;
    return {
      userId: user.id,
      isActive: user.isActive,
      roles: user.roles.filter((role) => roleEffectiveAt(role, at)).map(({ kind, departmentId }) => ({ kind, departmentId })),
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
