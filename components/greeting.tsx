import { motion } from 'framer-motion';
import { AmeriVetLogo } from '@/components/amerivet-logo';

export const Greeting = () => {
  return (
    <div
      key="overview"
      className="max-w-3xl mx-auto md:mt-20 px-8 size-full flex flex-col justify-center"
    >
      <div className="flex justify-center mb-6">
        <AmeriVetLogo
          alt="Amerivet Logo"
          width={160}
          height={48}
          priority
        />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5 }}
        className="text-2xl font-semibold"
      >
        Hi! I&apos;m Susie 👋
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.6 }}
        className="text-2xl text-zinc-500"
      >
        Your Amerivet Benefits Assistant
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.7 }}
        className="text-lg text-zinc-400 mt-4"
      >
        I&apos;ll help you understand and choose the best employee benefits for you. Just send me a message to get started!
      </motion.div>
    </div>
  );
};
