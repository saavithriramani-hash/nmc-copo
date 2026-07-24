import Link from 'next/link';
import { notFound } from 'next/navigation';
import { computeAnomalies } from '@/lib/anomalies';
import { guard } from '@/lib/authz';
import { requireSession } from '@/lib/session';

/**
 * Pre-calculation anomaly report (FR-13). Faculty see this BEFORE they
 * compute — the six checks the requirements name, each grouped, so
 * problems are fixed at the source, not discovered in the numbers.
 */
export default async function ReviewPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;

  // Reveals per-student mark presence → marks.read scope (NFR-10).
  if (!(await guard.check(user.userId, { type: 'marks.read', courseId })).allow) notFound();

  const report = await computeAnomalies(courseId);

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="font-medium">Pre-calculation review</h2>
        <p className="text-xs text-gray-600">
          {report.enrolmentCount} students · {report.assessmentCount} assessments. Fix anything below before computing
          attainment — a clean review means every number will have complete inputs.
        </p>
      </div>

      {report.clean ? (
        <p className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
          No anomalies found. The course is ready to compute.
        </p>
      ) : null}

      <Finding
        title="Marks over the item maximum"
        count={report.marksOverMax.length}
        help="A recorded mark exceeds the item's maximum — usually an import mistake or a maximum lowered after entry."
      >
        {report.marksOverMax.length > 0 ? (
          <Table head={['Register no.', 'Student', 'Assessment', 'Item', 'Mark', 'Max']}>
            {report.marksOverMax.map((row, i) => (
              <tr key={i}>
                <Td mono>{row.registerNumber}</Td>
                <Td>{row.studentName}</Td>
                <Td>{row.assessmentName}</Td>
                <Td>{row.itemLabel}</Td>
                <Td center className="text-red-700 font-medium">{row.value}</Td>
                <Td center>{row.maxMark}</Td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Finding>

      <Finding
        title="Students answering more optional questions than permitted"
        count={report.overAttempts.length}
        help="A section with an “answer any n of m” rule where the student has marks in more than n questions — decide which count."
      >
        {report.overAttempts.length > 0 ? (
          <Table head={['Register no.', 'Student', 'Assessment', 'Section', 'Attempted', 'Permitted']}>
            {report.overAttempts.map((row, i) => (
              <tr key={i}>
                <Td mono>{row.registerNumber}</Td>
                <Td>{row.studentName}</Td>
                <Td>{row.assessmentName}</Td>
                <Td>{row.sectionName}</Td>
                <Td center className="text-red-700 font-medium">{row.attempted}</Td>
                <Td center>{row.permitted}</Td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Finding>

      <Finding
        title="Students with no marks in an assessment"
        count={report.studentsWithNoMarks.length}
        help="Enrolled, but not a single mark recorded for this assessment — absent, or simply not entered yet."
      >
        {report.studentsWithNoMarks.length > 0 ? (
          <Table head={['Assessment', 'Register no.', 'Student']}>
            {report.studentsWithNoMarks.map((row, i) => (
              <tr key={i}>
                <Td>{row.assessmentName}</Td>
                <Td mono>{row.registerNumber}</Td>
                <Td>{row.studentName}</Td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Finding>

      <Finding
        title="Items nobody attempted"
        count={report.unattemptedItems.length}
        help="Every enrolled student left this item blank — check the item exists to be answered, or that marks were entered."
      >
        {report.unattemptedItems.length > 0 ? (
          <Table head={['Assessment', 'Item']}>
            {report.unattemptedItems.map((row, i) => (
              <tr key={i}>
                <Td>{row.assessmentName}</Td>
                <Td>{row.itemLabel}</Td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Finding>

      <Finding
        title="Course outcomes assessed nowhere"
        count={report.unassessedCos.length}
        help="No item or assessment maps to these COs, so they can carry no direct attainment. Tag an item, or add an assessment."
      >
        {report.unassessedCos.length > 0 ? (
          <Table head={['CO', 'Statement']}>
            {report.unassessedCos.map((row, i) => (
              <tr key={i}>
                <Td>{row.code}</Td>
                <Td>{row.statement}</Td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Finding>

      <Finding
        title="Indirect feedback below the response floor"
        count={report.feedbackShort.length}
        help="COs whose feedback response count is below the configured floor — the indirect measure may be unreliable."
      >
        {report.feedbackShort.length > 0 ? (
          <Table head={['CO', 'Responses', 'Note']}>
            {report.feedbackShort.map((row, i) => (
              <tr key={i}>
                <Td>{row.coCode}</Td>
                <Td center>{row.responses}</Td>
                <Td>{row.note}</Td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Finding>

      <p className="text-xs text-gray-500">
        Enter or correct marks on the{' '}
        <Link href={`/courses/${courseId}/marks`} className="text-blue-700 hover:underline">Marks</Link> tab; adjust
        structure and CO tags on{' '}
        <Link href={`/courses/${courseId}/assessments`} className="text-blue-700 hover:underline">Assessments</Link>.
      </p>
    </div>
  );
}

function Finding({ title, count, help, children }: { title: string; count: number; help: string; children?: React.ReactNode }) {
  return (
    <section className="border border-gray-300 rounded bg-white">
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-gray-200 ${count > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
        <span className={`inline-block w-5 text-center rounded text-xs font-bold ${count > 0 ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {count}
        </span>
        <span className="font-medium">{title}</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-gray-600 mb-2">{help}</p>
        {children}
      </div>
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="max-h-72 overflow-y-auto border border-gray-200 rounded">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-gray-100">
          <tr className="text-left">
            {head.map((h) => (
              <th key={h} className="border border-gray-300 px-2 py-1">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, mono, center, className = '' }: { children: React.ReactNode; mono?: boolean; center?: boolean; className?: string }) {
  return (
    <td className={`border border-gray-300 px-2 py-1 ${mono ? 'font-mono' : ''} ${center ? 'text-center' : ''} ${className}`}>
      {children}
    </td>
  );
}
