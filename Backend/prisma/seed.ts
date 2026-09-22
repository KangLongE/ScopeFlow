import { z } from "zod";

const values = z.object({
  SEED_EMAIL: z.string().email(),
  SEED_PASSWORD: z.string().min(10),
}).parse(process.env);

const [{ auth }, { prisma }, { defaultRates }] = await Promise.all([
  import("@/lib/auth/auth"),
  import("@/lib/db/prisma"),
  import("@/lib/model"),
]);

let user = await prisma.user.findUnique({ where: { email: values.SEED_EMAIL } });
if (!user) {
  const result = await auth.api.signUpEmail({ body: { email: values.SEED_EMAIL, password: values.SEED_PASSWORD, name: "Local Owner" } });
  user = result.user;
}

const existing = await prisma.workspaceMember.findFirst({ where: { userId: user.id }, include: { workspace: true } });
if (!existing) {
  await prisma.workspace.create({
    data: {
      name: "Local Test Workspace",
      members: { create: { userId: user.id, role: "OWNER" } },
      rateCard: { create: { rates: defaultRates } },
      clients: {
        create: {
          name: "Sample Client",
          email: "client@example.invalid",
          company: "Sample Company",
          projects: { create: { name: "Sample Project", status: "REQUIREMENT_GATHERING" } },
        },
      },
    },
  });
}

console.info("Development seed completed.");
await prisma.$disconnect();

