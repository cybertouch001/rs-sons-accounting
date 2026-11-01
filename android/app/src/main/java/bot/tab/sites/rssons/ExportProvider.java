package bot.tab.sites.rssons;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;

/** Android 6-9 only: lets "Share / Open" hand a saved export to another app (Android 10+ uses the Downloads folder's own link). */
public class ExportProvider extends ContentProvider {
    static final String AUTH = "bot.tab.sites.rssons.exports";
    static Uri uriFor(File f) { return Uri.parse("content://" + AUTH + "/" + Uri.encode(f.getName())); }
    private File fileOf(Uri u) throws FileNotFoundException {
        File dir = new File(getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "RS Sons Accounting");
        String name = u.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) throw new FileNotFoundException();
        File f = new File(dir, name); if (!f.exists()) throw new FileNotFoundException(name); return f;
    }
    @Override public boolean onCreate() { return true; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException { return ParcelFileDescriptor.open(fileOf(uri), ParcelFileDescriptor.MODE_READ_ONLY); }
    @Override public String getType(Uri uri) {
        String n = uri.getLastPathSegment(); String ext = n == null ? "" : MimeTypeMap.getFileExtensionFromUrl(Uri.encode(n));
        String t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext == null ? "" : ext.toLowerCase());
        return t == null ? "application/octet-stream" : t;
    }
    @Override public Cursor query(Uri uri, String[] proj, String sel, String[] args, String sort) {
        try { File f = fileOf(uri); MatrixCursor c = new MatrixCursor(new String[]{ OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }); c.addRow(new Object[]{ f.getName(), f.length() }); return c; }
        catch (FileNotFoundException e) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
