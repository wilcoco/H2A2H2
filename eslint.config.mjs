import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // TDZ 방지: 변수가 선언되기 전에 참조되면 build error.
    // beta-5b 핫픽스(5ddbd7f)의 'Cannot access eD before initialization' 같은
    // 런타임 폭탄을 빌드 단계에서 잡기 위함.
    rules: {
      "no-use-before-define": "off", // TS 룰로 대체
      "@typescript-eslint/no-use-before-define": ["error", {
        functions: false,   // 함수는 호이스팅되니 OK
        classes: true,
        variables: true,
        enums: true,
        typedefs: false,
        ignoreTypeReferences: true,
      }],
    },
  },
];

export default eslintConfig;
