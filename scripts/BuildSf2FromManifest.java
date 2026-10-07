/**
 * Pack the single cycle wavetables exported by
 * scripts/export-periodicwave-samples.mjs into a General MIDI SoundFont 2
 * bank, using the JDK's own SF2 writer.
 *
 * com.sun.media.sound.SF2Soundbank#save is the same writer Gervill uses for
 * its built in "emergency" soundbank, but the package is not exported by
 * java.desktop, so the tool has to be launched with --add-exports.
 *
 * Usage:
 *   java --add-exports java.desktop/com.sun.media.sound=ALL-UNNAMED \
 *        scripts/BuildSf2FromManifest.java <out.sf2> <manifest.tsv> [more manifests...]
 *
 * Bank 0 rows become one instrument per GM program with one zone per octave
 * variant; bank 128 rows become a drum kit (one zone per key, no loop).
 */
import com.sun.media.sound.ModelPatch;
import com.sun.media.sound.SF2Instrument;
import com.sun.media.sound.SF2InstrumentRegion;
import com.sun.media.sound.SF2Layer;
import com.sun.media.sound.SF2LayerRegion;
import com.sun.media.sound.SF2Region;
import com.sun.media.sound.SF2Sample;
import com.sun.media.sound.SF2Soundbank;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class BuildSf2FromManifest {

    /** One manifest row: a single cycle sample plus its SF2 generator values. */
    private static final class Row {
        String file;
        String absolutePath;
        String name;
        int bank;
        int program;
        int octave;
        int lokey;
        int hikey;
        int rootKey;
        int sampleRate;
        int loopStart;
        int loopEnd;
        int loopMode;
        int pitchCorrection;
        int attackVolEnv;
        int decayVolEnv;
        int sustainVolEnv;
        int releaseVolEnv;
        int vibLfoToPitch;
        int freqVibLFO;
        int initialFilterFc;
        int modEnvToFilterFc;
        int decayModEnv;
        int sustainModEnv;
        int releaseModEnv;
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: java --add-exports java.desktop/com.sun.media.sound=ALL-UNNAMED "
                    + "scripts/BuildSf2FromManifest.java <out.sf2> <manifest.tsv> [more manifests...]");
            System.exit(2);
        }
        Path output = Paths.get(args[0]).toAbsolutePath();
        String bankName = "PicoAudio Periodic Wave";

        List<Row> rows = new ArrayList<>();
        for (int i = 1; i < args.length; i++) rows.addAll(readManifest(Paths.get(args[i]).toAbsolutePath()));
        // Files are relative to their own manifest, so remember which one each
        // row came from before regrouping.
        Map<Integer, List<Row>> byPreset = new LinkedHashMap<>();
        for (Row row : rows) {
            byPreset.computeIfAbsent(row.bank * 1000 + row.program, k -> new ArrayList<>()).add(row);
        }

        SF2Soundbank bank = new SF2Soundbank();
        bank.setName(bankName);
        bank.setVendor("PicoAudio");
        bank.setDescription("General MIDI bank built from the PicoAudio periodic wave tables "
                + "(one cycle per octave variant, seamless loop)");
        bank.setCreationDate(LocalDate.now().toString());
        bank.setTools("JDK com.sun.media.sound.SF2Soundbank");
        bank.setTargetEngine("E-mu 10K1");

        long sampleFrames = 0;
        for (Map.Entry<Integer, List<Row>> entry : byPreset.entrySet()) {
            List<Row> presetRows = entry.getValue();
            Row first = presetRows.get(0);
            int program = first.program;
            boolean isDrumKit = first.bank >= 128;
            String presetName = clip(isDrumKit ? "PicoAudio Kit" : first.name, 20);

            // One SF2 instrument (layer) per preset: one zone per octave
            // variant for the melodic programs, one zone per key for the kit.
            // The key ranges live on the preset zones as well, exactly like
            // the drum kit Gervill builds for its emergency soundbank.
            SF2Layer layer = new SF2Layer(bank);
            layer.setName(presetName);
            bank.addResource(layer);

            for (Row row : presetRows) {
                byte[] pcm = readWavData(Paths.get(row.absolutePath));
                sampleFrames += pcm.length / 2;

                SF2Sample sample = new SF2Sample(bank);
                sample.setName(clip("p" + pad3(row.program) + "_o" + row.octave + "_" + row.name, 20));
                sample.setData(pcm);
                sample.setSampleRate(row.sampleRate);
                sample.setOriginalPitch(row.rootKey);
                sample.setPitchCorrection((byte) row.pitchCorrection);
                sample.setStartLoop(row.loopStart);
                sample.setEndLoop(row.loopEnd);
                sample.setSampleType(1); // mono, PCM
                bank.addResource(sample);

                SF2LayerRegion zone = new SF2LayerRegion();
                zone.setSample(sample);
                // The range belongs on the instrument zone too: without it
                // every preset zone would match every octave variant and all
                // five of them would sound together.
                zone.putBytes(SF2Region.GENERATOR_KEYRANGE,
                        new byte[]{(byte) row.lokey, (byte) row.hikey});
                if (row.loopMode != 0) put(zone, SF2Region.GENERATOR_SAMPLEMODES, 1);
                put(zone, SF2Region.GENERATOR_ATTACKVOLENV, row.attackVolEnv);
                put(zone, SF2Region.GENERATOR_DECAYVOLENV, row.decayVolEnv);
                put(zone, SF2Region.GENERATOR_SUSTAINVOLENV, row.sustainVolEnv);
                put(zone, SF2Region.GENERATOR_RELEASEVOLENV, row.releaseVolEnv);
                if (row.vibLfoToPitch > 0) {
                    put(zone, SF2Region.GENERATOR_VIBLFOTOPITCH, row.vibLfoToPitch);
                    put(zone, SF2Region.GENERATOR_FREQVIBLFO, row.freqVibLFO);
                }
                if (row.initialFilterFc > 0) {
                    put(zone, SF2Region.GENERATOR_INITIALFILTERFC, row.initialFilterFc);
                    put(zone, SF2Region.GENERATOR_MODENVTOFILTERFC, row.modEnvToFilterFc);
                    put(zone, SF2Region.GENERATOR_DECAYMODENV, row.decayModEnv);
                    put(zone, SF2Region.GENERATOR_SUSTAINMODENV, row.sustainModEnv);
                    put(zone, SF2Region.GENERATOR_RELEASEMODENV, row.releaseModEnv);
                }
                layer.getRegions().add(zone);
            }

            SF2Instrument preset = new SF2Instrument(bank);
            preset.setName(presetName);
            preset.setPatch(new ModelPatch(first.bank, program, isDrumKit));
            for (Row row : presetRows) {
                SF2InstrumentRegion presetZone = new SF2InstrumentRegion();
                presetZone.setLayer(layer);
                presetZone.putBytes(SF2Region.GENERATOR_KEYRANGE,
                        new byte[]{(byte) row.lokey, (byte) row.hikey});
                preset.getRegions().add(presetZone);
            }
            bank.addInstrument(preset);
        }

        bank.save(output.toFile());

        // Read the file back with the JDK reader: cheap structural check.
        SF2Soundbank check = new SF2Soundbank(output.toFile());
        System.out.printf("wrote %s%n", output);
        System.out.printf("  presets : %d (bank %d)%n", check.getInstruments().length,
                check.getInstruments().length > 0 ? check.getInstruments()[0].getPatch().getBank() : -1);
        System.out.printf("  layers  : %d%n", check.getLayers().length);
        System.out.printf("  samples : %d (%d frames from the manifest)%n",
                check.getSamples().length, sampleFrames);
        System.out.printf("  bytes   : %d (%.1f KiB)%n", Files.size(output), Files.size(output) / 1024.0);
    }

    private static void put(SF2Region zone, int generator, int value) {
        zone.putInteger(generator, value);
    }

    private static List<Row> readManifest(Path manifest) throws IOException {
        List<String> lines = Files.readAllLines(manifest, StandardCharsets.UTF_8);
        List<Row> rows = new ArrayList<>();
        Map<String, Integer> index = new LinkedHashMap<>();
        for (String line : lines) {
            if (line.isBlank() || line.startsWith("#")) continue;
            String[] cells = line.split("\t", -1);
            if (index.isEmpty() && cells[0].equals("file")) {
                for (int i = 0; i < cells.length; i++) index.put(cells[i], i);
                continue;
            }
            Row row = new Row();
            row.file = cells[index.get("file")];
            row.absolutePath = manifest.getParent().resolve(row.file).toString();
            row.name = cells[index.get("name")];
            row.bank = num(cells, index, "bank");
            row.program = num(cells, index, "program");
            row.octave = num(cells, index, "octave");
            row.lokey = num(cells, index, "lokey");
            row.hikey = num(cells, index, "hikey");
            row.rootKey = num(cells, index, "rootKey");
            row.sampleRate = num(cells, index, "sampleRate");
            row.loopStart = num(cells, index, "loopStart");
            row.loopEnd = num(cells, index, "loopEnd");
            row.loopMode = num(cells, index, "loopMode");
            row.pitchCorrection = num(cells, index, "pitchCorrection");
            row.attackVolEnv = num(cells, index, "attackVolEnv");
            row.decayVolEnv = num(cells, index, "decayVolEnv");
            row.sustainVolEnv = num(cells, index, "sustainVolEnv");
            row.releaseVolEnv = num(cells, index, "releaseVolEnv");
            row.vibLfoToPitch = num(cells, index, "vibLfoToPitch");
            row.freqVibLFO = num(cells, index, "freqVibLFO");
            row.initialFilterFc = num(cells, index, "initialFilterFc");
            row.modEnvToFilterFc = num(cells, index, "modEnvToFilterFc");
            row.decayModEnv = num(cells, index, "decayModEnv");
            row.sustainModEnv = num(cells, index, "sustainModEnv");
            row.releaseModEnv = num(cells, index, "releaseModEnv");
            rows.add(row);
        }
        if (rows.isEmpty()) throw new IOException("manifest has no rows: " + manifest);
        return rows;
    }

    private static int num(String[] cells, Map<String, Integer> index, String column) {
        Integer at = index.get(column);
        if (at == null || at >= cells.length) throw new IllegalArgumentException("missing column " + column);
        return Integer.parseInt(cells[at].trim());
    }

    /** Pulls the 16 bit mono PCM payload out of a RIFF/WAVE file. */
    private static byte[] readWavData(Path file) throws IOException {
        byte[] bytes = Files.readAllBytes(file);
        int position = 12;
        while (position + 8 <= bytes.length) {
            String id = new String(bytes, position, 4, StandardCharsets.US_ASCII);
            int size = le32(bytes, position + 4);
            if (id.equals("data")) {
                int from = position + 8;
                return Arrays.copyOfRange(bytes, from, Math.min(from + size, bytes.length));
            }
            position += 8 + size + (size & 1);
        }
        throw new IOException("no data chunk in " + file);
    }

    private static int le32(byte[] bytes, int at) {
        return (bytes[at] & 0xff) | ((bytes[at + 1] & 0xff) << 8)
                | ((bytes[at + 2] & 0xff) << 16) | ((bytes[at + 3] & 0xff) << 24);
    }

    private static String pad3(int value) {
        return String.format("%03d", value);
    }

    private static String clip(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max);
    }
}
